// Minimal structural typings for the WebGPU objects we touch, so the library
// compiles without depending on @webgpu/types.

export type GPUBufferLike = object;
export type GPUTextureLike = { createView(): unknown };
export type GPUShaderModuleLike = {
  getCompilationInfo?: () => Promise<{
    messages: Array<{ type: string; message: string; lineNum: number; linePos: number }>;
  }>;
};
export type GPUDeviceLike = {
  queue: {
    writeBuffer(buffer: GPUBufferLike, offset: number, data: ArrayBufferView): void;
    copyExternalImageToTexture(source: unknown, destination: unknown, size: unknown): void;
    submit(commands: unknown[]): void;
  };
  lost: Promise<unknown>;
  createBuffer(descriptor: unknown): GPUBufferLike;
  createTexture(descriptor: unknown): GPUTextureLike;
  createSampler(descriptor: unknown): unknown;
  createShaderModule(descriptor: unknown): GPUShaderModuleLike;
  createRenderPipelineAsync(descriptor: unknown): Promise<{ getBindGroupLayout(index: number): unknown }>;
  createBindGroup(descriptor: unknown): unknown;
  createCommandEncoder(): {
    beginRenderPass(descriptor: unknown): {
      setPipeline(pipeline: unknown): void;
      setBindGroup(index: number, bindGroup: unknown): void;
      draw(vertexCount: number, instanceCount: number, firstVertex: number, firstInstance: number): void;
      end(): void;
    };
    finish(): unknown;
  };
};
export type GPUCanvasContextLike = {
  configure(descriptor: unknown): void;
  getCurrentTexture(): GPUTextureLike;
};
export type GPUAdapterLike = { requestDevice(): Promise<GPUDeviceLike> };
export type NavigatorWithGPU = Navigator & {
  gpu?: { requestAdapter(): Promise<GPUAdapterLike | null>; getPreferredCanvasFormat(): string };
};

export const GPUBufferUsage = { COPY_DST: 0x0008, UNIFORM: 0x0040 };
export const GPUTextureUsage = { COPY_DST: 0x0002, TEXTURE_BINDING: 0x0004, RENDER_ATTACHMENT: 0x0010 };
