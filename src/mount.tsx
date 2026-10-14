'use client';

import { memo, useEffect, useRef, type CSSProperties } from 'react';
import {
  GPUBufferUsage,
  GPUTextureUsage,
  type GPUCanvasContextLike,
  type NavigatorWithGPU,
} from './types';
import { NOISE_SIZE, loadNoiseBitmap } from './noise-texture';

export interface ShaderUniformEnv {
  width: number;
  height: number;
  pixelRatio: number;
  time: number;
}

export interface WebGPUShaderCanvasProps {
  className?: string;
  style?: CSSProperties;
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  /** WGSL source with vs_main/fs_main entry points and a group(0) binding(0) uniform buffer. */
  shader: string;
  /** Total float slots in the uniform buffer, including trailing struct padding to a 16-byte multiple. */
  uniformFloatCount: number;
  /** Writes this frame's uniform values into the buffer; must match the WGSL struct layout. */
  packUniforms: (data: Float32Array, env: ShaderUniformEnv) => void;
  /** Set when the shader declares the noise texture + sampler at bindings 1 and 2. */
  usesNoiseTexture?: boolean;
  speed?: number;
  frame?: number;
  maxPixelCount?: number;
  /** Painted behind the shader via CSS so a not-yet-rendered canvas isn't a black hole. */
  backgroundColor?: string;
  /** Fires when WebGPU cannot render (no adapter, device/compile/pipeline failure, device loss). */
  onRenderFailed?: () => void;
}

export const WebGPUShaderCanvas = memo(function WebGPUShaderCanvas({
  className,
  style,
  width,
  height,
  shader,
  uniformFloatCount,
  packUniforms,
  usesNoiseTexture = false,
  speed = 1,
  frame = 0,
  maxPixelCount = 1_500_000,
  backgroundColor,
  onRenderFailed,
}: WebGPUShaderCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onRenderFailedRef = useRef(onRenderFailed);
  onRenderFailedRef.current = onRenderFailed;

  useEffect(() => {
    let cancelled = false;
    let animationFrame: number | undefined;
    let resizeObserver: ResizeObserver | undefined;

    // Every abort path must report failure, otherwise the canvas dies
    // silently and the parent keeps a blank plate mounted forever. The
    // reason is logged because the parent unmounts on failure — without it
    // a device with any broken pipeline step just shows nothing.
    const fail = (reason: string) => {
      if (cancelled) return;
      console.warn(`WebGPU shader unavailable (${reason})`);
      onRenderFailedRef.current?.();
    };

    const canvas = canvasRef.current;
    const gpu = (navigator as NavigatorWithGPU).gpu;
    if (!canvas || !gpu) {
      fail('navigator.gpu missing');
      return;
    }

    const start = async () => {
      try {
        const adapter = await gpu.requestAdapter();
        if (cancelled) return;
        if (!adapter) {
          fail('no adapter granted');
          return;
        }
        const device = await adapter.requestDevice();
        if (cancelled) return;
        const context = canvas.getContext('webgpu') as unknown as GPUCanvasContextLike | null;
        if (!context) {
          fail('no webgpu canvas context');
          return;
        }

        const format = gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'premultiplied' });

        const uniformBuffer = device.createBuffer({
          size: uniformFloatCount * Float32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const bindGroupEntries: unknown[] = [{ binding: 0, resource: { buffer: uniformBuffer } }];
        if (usesNoiseTexture) {
          const noiseTexture = device.createTexture({
            size: [NOISE_SIZE, NOISE_SIZE, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
          });
          const bitmap = await loadNoiseBitmap();
          if (cancelled) return;
          device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: noiseTexture, premultipliedAlpha: false }, [NOISE_SIZE, NOISE_SIZE]);
          bindGroupEntries.push(
            { binding: 1, resource: noiseTexture.createView() },
            { binding: 2, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) }
          );
        }

        const shaderModule = device.createShaderModule({ code: shader });
        const compilation = await shaderModule.getCompilationInfo?.();
        const errors = compilation?.messages.filter((message) => message.type === 'error') ?? [];
        if (errors.length) {
          console.error('WebGPU shader failed to compile:', errors);
          fail('shader compile error');
          return;
        }

        const pipeline = await device.createRenderPipelineAsync({
          layout: 'auto',
          vertex: { module: shaderModule, entryPoint: 'vs_main' },
          fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format }] },
          primitive: { topology: 'triangle-list' },
        });
        const bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: bindGroupEntries,
        });

        const updateCanvasSize = () => {
          const dpr = window.devicePixelRatio || 1;
          const cssWidth = Math.max(1, Math.round(canvas.clientWidth * dpr));
          const cssHeight = Math.max(1, Math.round(canvas.clientHeight * dpr));
          const factor = Math.min(1, Math.sqrt(maxPixelCount / (cssWidth * cssHeight)));
          const nextWidth = Math.max(1, Math.floor(cssWidth * factor));
          const nextHeight = Math.max(1, Math.floor(cssHeight * factor));
          if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
            canvas.width = nextWidth;
            canvas.height = nextHeight;
          }
          return dpr * factor;
        };
        let effectivePixelRatio = updateCanvasSize();
        resizeObserver = new ResizeObserver(() => {
          effectivePixelRatio = updateCanvasSize();
        });
        resizeObserver.observe(canvas);

        const uniformData = new Float32Array(uniformFloatCount);
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const startedAt = performance.now();

        const render = (now: number) => {
          if (cancelled) return;
          packUniforms(uniformData, {
            width: canvas.width,
            height: canvas.height,
            pixelRatio: effectivePixelRatio,
            time: ((now - startedAt) / 1000) * speed + frame / 1000,
          });
          device.queue.writeBuffer(uniformBuffer, 0, uniformData);

          const pass = device.createCommandEncoder();
          const renderPass = pass.beginRenderPass({
            colorAttachments: [
              {
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store',
              },
            ],
          });
          renderPass.setPipeline(pipeline);
          renderPass.setBindGroup(0, bindGroup);
          renderPass.draw(3, 1, 0, 0);
          renderPass.end();
          device.queue.submit([pass.finish()]);
          if (!reducedMotion) animationFrame = requestAnimationFrame(render);
        };

        render(performance.now());
        device.lost.then(() => { fail('device lost'); cancelled = true; }).catch(() => {});
      } catch (error) {
        console.error('WebGPU shader could not start:', error);
        fail('exception during setup');
      }
    };

    void start();
    return () => {
      cancelled = true;
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
    };
  }, [shader, uniformFloatCount, packUniforms, usesNoiseTexture, speed, frame, maxPixelCount]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        ...style,
        width: width ?? style?.width,
        height: height ?? style?.height,
        backgroundColor: backgroundColor ?? style?.backgroundColor,
        display: 'block',
      }}
    />
  );
});
