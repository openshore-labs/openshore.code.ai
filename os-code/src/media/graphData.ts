// The ComfyUI workflows OpenShore ships for the model library's media jobs
// (2026-10-12), in ComfyUI's API format: one per model family and job.
// Converted from Comfy-Org's own templates (Comfy-Org/workflow_templates at
// cdccb2e) and checked node by node, input by input, against ComfyUI's source
// at v0.39 (e8665ca): every required input present, every class real. The one
// exception is lama:remove, whose nodes come from Acly's comfyui-inpaint-nodes
// pack, not core; it is held to a device check. FLUX.2 klein reads the 8-bit
// diffusion model and text encoder in both its jobs, so one 9.4 GB download
// serves Make pictures and Edit by asking on a laptop.
//
// Data only. media/graphs.ts fills the placeholders ({{prompt}}, {{image}},
// {{seed}} and so on) and swaps a loader's file for another size of the same
// family. Do not edit by hand without re-checking the node against source.
import type { GraphSpec } from './graphs.js';

export const GRAPH_DATA: Record<string, GraphSpec> = {
  'flux2-klein:create': {
    graph: {
      '1': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'flux-2-klein-4b-fp8.safetensors',
          weight_dtype: 'default',
        },
      },
      '2': {
        class_type: 'CLIPLoader',
        inputs: {
          clip_name: 'qwen_3_4b_fp8_mixed.safetensors',
          type: 'flux2',
          device: 'default',
        },
      },
      '3': {
        class_type: 'VAELoader',
        inputs: {
          vae_name: 'flux2-vae.safetensors',
        },
      },
      '4': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['2', 0],
          text: '{{prompt}}',
        },
      },
      '5': {
        class_type: 'ConditioningZeroOut',
        inputs: {
          conditioning: ['4', 0],
        },
      },
      '6': {
        class_type: 'CFGGuider',
        inputs: {
          model: ['1', 0],
          positive: ['4', 0],
          negative: ['5', 0],
          cfg: 1.0,
        },
      },
      '7': {
        class_type: 'KSamplerSelect',
        inputs: {
          sampler_name: 'euler',
        },
      },
      '8': {
        class_type: 'Flux2Scheduler',
        inputs: {
          steps: 4,
          width: 1024,
          height: 1024,
        },
      },
      '9': {
        class_type: 'RandomNoise',
        inputs: {
          noise_seed: '{{seed}}',
        },
      },
      '10': {
        class_type: 'EmptyFlux2LatentImage',
        inputs: {
          width: 1024,
          height: 1024,
          batch_size: 1,
        },
      },
      '11': {
        class_type: 'SamplerCustomAdvanced',
        inputs: {
          noise: ['9', 0],
          guider: ['6', 0],
          sampler: ['7', 0],
          sigmas: ['8', 0],
          latent_image: ['10', 0],
        },
      },
      '12': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['11', 0],
          vae: ['3', 0],
        },
      },
      '13': {
        class_type: 'SaveImage',
        inputs: {
          images: ['12', 0],
          filename_prefix: 'openshore/flux2-klein',
        },
      },
    },
    placeholders: {
      prompt: ['4.text'],
      seed: ['9.noise_seed'],
    },
    minComfyVersion: '0.9.2',
    output: 'image',
  },
  'flux2-klein:instruct': {
    graph: {
      '1': {
        class_type: 'LoadImage',
        inputs: {
          image: '{{image}}',
        },
      },
      '2': {
        class_type: 'ImageScaleToTotalPixels',
        inputs: {
          image: ['1', 0],
          upscale_method: 'nearest-exact',
          megapixels: 1.0,
          resolution_steps: 1,
        },
      },
      '3': {
        class_type: 'GetImageSize',
        inputs: {
          image: ['2', 0],
        },
      },
      '4': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'flux-2-klein-4b-fp8.safetensors',
          weight_dtype: 'default',
        },
      },
      '5': {
        class_type: 'CLIPLoader',
        inputs: {
          clip_name: 'qwen_3_4b_fp8_mixed.safetensors',
          type: 'flux2',
          device: 'default',
        },
      },
      '6': {
        class_type: 'VAELoader',
        inputs: {
          vae_name: 'flux2-vae.safetensors',
        },
      },
      '7': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['5', 0],
          text: '{{prompt}}',
        },
      },
      '8': {
        class_type: 'ConditioningZeroOut',
        inputs: {
          conditioning: ['7', 0],
        },
      },
      '9': {
        class_type: 'VAEEncode',
        inputs: {
          pixels: ['2', 0],
          vae: ['6', 0],
        },
      },
      '10': {
        class_type: 'ReferenceLatent',
        inputs: {
          conditioning: ['7', 0],
          latent: ['9', 0],
        },
      },
      '11': {
        class_type: 'ReferenceLatent',
        inputs: {
          conditioning: ['8', 0],
          latent: ['9', 0],
        },
      },
      '12': {
        class_type: 'CFGGuider',
        inputs: {
          model: ['4', 0],
          positive: ['10', 0],
          negative: ['11', 0],
          cfg: 1.0,
        },
      },
      '13': {
        class_type: 'KSamplerSelect',
        inputs: {
          sampler_name: 'euler',
        },
      },
      '14': {
        class_type: 'Flux2Scheduler',
        inputs: {
          steps: 4,
          width: ['3', 0],
          height: ['3', 1],
        },
      },
      '15': {
        class_type: 'RandomNoise',
        inputs: {
          noise_seed: '{{seed}}',
        },
      },
      '16': {
        class_type: 'EmptyFlux2LatentImage',
        inputs: {
          width: ['3', 0],
          height: ['3', 1],
          batch_size: 1,
        },
      },
      '17': {
        class_type: 'SamplerCustomAdvanced',
        inputs: {
          noise: ['15', 0],
          guider: ['12', 0],
          sampler: ['13', 0],
          sigmas: ['14', 0],
          latent_image: ['16', 0],
        },
      },
      '18': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['17', 0],
          vae: ['6', 0],
        },
      },
      '19': {
        class_type: 'SaveImage',
        inputs: {
          images: ['18', 0],
          filename_prefix: 'openshore/flux2-klein',
        },
      },
    },
    placeholders: {
      prompt: ['7.text'],
      image: ['1.image'],
      seed: ['15.noise_seed'],
    },
    minComfyVersion: '0.9.2',
    output: 'image',
  },
  'z-image-turbo:create': {
    graph: {
      '1': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'z_image_turbo_int8_convrot.safetensors',
          weight_dtype: 'default',
        },
      },
      '2': {
        class_type: 'CLIPLoader',
        inputs: {
          clip_name: 'qwen_3_4b_fp8_mixed.safetensors',
          type: 'lumina2',
          device: 'default',
        },
      },
      '3': {
        class_type: 'VAELoader',
        inputs: {
          vae_name: 'ae.safetensors',
        },
      },
      '4': {
        class_type: 'ModelSamplingAuraFlow',
        inputs: {
          model: ['1', 0],
          shift: 3.0,
        },
      },
      '5': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['2', 0],
          text: '{{prompt}}',
        },
      },
      '6': {
        class_type: 'ConditioningZeroOut',
        inputs: {
          conditioning: ['5', 0],
        },
      },
      '7': {
        class_type: 'EmptySD3LatentImage',
        inputs: {
          width: 1024,
          height: 1024,
          batch_size: 1,
        },
      },
      '8': {
        class_type: 'KSampler',
        inputs: {
          model: ['4', 0],
          positive: ['5', 0],
          negative: ['6', 0],
          latent_image: ['7', 0],
          seed: '{{seed}}',
          steps: 8,
          cfg: 1.0,
          sampler_name: 'res_multistep',
          scheduler: 'simple',
          denoise: 1.0,
        },
      },
      '9': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['8', 0],
          vae: ['3', 0],
        },
      },
      '10': {
        class_type: 'SaveImage',
        inputs: {
          images: ['9', 0],
          filename_prefix: 'openshore/z-image-turbo',
        },
      },
    },
    placeholders: {
      prompt: ['5.text'],
      seed: ['8.seed'],
    },
    minComfyVersion: '0.27.0',
    output: 'image',
  },
  'hidream-o1:create': {
    graph: {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: {
          ckpt_name: 'hidream_o1_image_dev_fp8_scaled.safetensors',
        },
      },
      '2': {
        class_type: 'ModelNoiseScale',
        inputs: {
          model: ['1', 0],
          noise_scale: 7.6,
        },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['1', 1],
          text: '{{prompt}}',
        },
      },
      '4': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['1', 1],
          text: '',
        },
      },
      '5': {
        class_type: 'EmptyHiDreamO1LatentImage',
        inputs: {
          width: 2048,
          height: 2048,
          batch_size: 1,
        },
      },
      '6': {
        class_type: 'BasicScheduler',
        inputs: {
          model: ['2', 0],
          scheduler: 'normal',
          steps: 28,
          denoise: 1.0,
        },
      },
      '7': {
        class_type: 'SamplerLCM',
        inputs: {
          s_noise: 1.0,
          s_noise_end: 1.0,
          noise_clip_std: 2.5,
        },
      },
      '8': {
        class_type: 'SamplerCustom',
        inputs: {
          model: ['2', 0],
          add_noise: true,
          noise_seed: '{{seed}}',
          cfg: 1.0,
          positive: ['3', 0],
          negative: ['4', 0],
          sampler: ['7', 0],
          sigmas: ['6', 0],
          latent_image: ['5', 0],
        },
      },
      '9': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['8', 0],
          vae: ['1', 2],
        },
      },
      '10': {
        class_type: 'SaveImage',
        inputs: {
          images: ['9', 0],
          filename_prefix: 'openshore/hidream-o1',
        },
      },
    },
    placeholders: {
      prompt: ['3.text'],
      seed: ['8.noise_seed'],
    },
    minComfyVersion: '0.28.0',
    output: 'image',
  },
  'ernie-image-turbo:create': {
    graph: {
      '1': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'ernie-image-turbo.safetensors',
          weight_dtype: 'default',
        },
      },
      '2': {
        class_type: 'CLIPLoader',
        inputs: {
          clip_name: 'ministral-3-3b.safetensors',
          type: 'flux2',
          device: 'default',
        },
      },
      '3': {
        class_type: 'VAELoader',
        inputs: {
          vae_name: 'flux2-vae.safetensors',
        },
      },
      '4': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['2', 0],
          text: '{{prompt}}',
        },
      },
      '5': {
        class_type: 'ConditioningZeroOut',
        inputs: {
          conditioning: ['4', 0],
        },
      },
      '6': {
        class_type: 'EmptyFlux2LatentImage',
        inputs: {
          width: 1024,
          height: 1024,
          batch_size: 1,
        },
      },
      '7': {
        class_type: 'KSampler',
        inputs: {
          model: ['1', 0],
          positive: ['4', 0],
          negative: ['5', 0],
          latent_image: ['6', 0],
          seed: '{{seed}}',
          steps: 8,
          cfg: 1.0,
          sampler_name: 'euler',
          scheduler: 'simple',
          denoise: 1.0,
        },
      },
      '8': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['7', 0],
          vae: ['3', 0],
        },
      },
      '9': {
        class_type: 'SaveImage',
        inputs: {
          images: ['8', 0],
          filename_prefix: 'openshore/ernie-image-turbo',
        },
      },
    },
    placeholders: {
      prompt: ['4.text'],
      seed: ['7.seed'],
    },
    minComfyVersion: '0.19.2',
    output: 'image',
  },
  'ming-image:create': {
    graph: {
      '1': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'ming_image_0.1_design_int8_convrot.safetensors',
          weight_dtype: 'default',
        },
      },
      '2': {
        class_type: 'ModelAttentionBackend',
        inputs: {
          model: ['1', 0],
          attention: 'comfy kitchen attention',
        },
      },
      '3': {
        class_type: 'ModelSamplingFlux',
        inputs: {
          model: ['2', 0],
          max_shift: 1.15,
          base_shift: 0.5,
          width: 1024,
          height: 1024,
        },
      },
      '4': {
        class_type: 'CLIPLoader',
        inputs: {
          clip_name: 'ming_image_0.1_ling_mini_2.0_int8_convrot.safetensors',
          type: 'qwen_image',
          device: 'default',
        },
      },
      '5': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['4', 0],
          text: '{{prompt}}',
        },
      },
      '6': {
        class_type: 'BasicGuider',
        inputs: {
          model: ['3', 0],
          conditioning: ['5', 0],
        },
      },
      '7': {
        class_type: 'BasicScheduler',
        inputs: {
          model: ['3', 0],
          scheduler: 'simple',
          steps: 12,
          denoise: 1.0,
        },
      },
      '8': {
        class_type: 'KSamplerSelect',
        inputs: {
          sampler_name: 'euler',
        },
      },
      '9': {
        class_type: 'RandomNoise',
        inputs: {
          noise_seed: '{{seed}}',
        },
      },
      '10': {
        class_type: 'EmptyLatentImage',
        inputs: {
          width: 1024,
          height: 1024,
          batch_size: 1,
        },
      },
      '11': {
        class_type: 'SamplerCustomAdvanced',
        inputs: {
          noise: ['9', 0],
          guider: ['6', 0],
          sampler: ['8', 0],
          sigmas: ['7', 0],
          latent_image: ['10', 0],
        },
      },
      '12': {
        class_type: 'VAELoader',
        inputs: {
          vae_name: 'ming_image_vae_bf16.safetensors',
        },
      },
      '13': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['11', 0],
          vae: ['12', 0],
        },
      },
      '14': {
        class_type: 'SaveImage',
        inputs: {
          images: ['13', 0],
          filename_prefix: 'openshore/ming-image',
        },
      },
    },
    placeholders: {
      prompt: ['5.text'],
      seed: ['9.noise_seed'],
    },
    minComfyVersion: '0.38.0',
    output: 'image',
  },
  'qwen-image-edit-2511:instruct': {
    graph: {
      '1': {
        class_type: 'LoadImage',
        inputs: {
          image: '{{image}}',
        },
      },
      '2': {
        class_type: 'FluxKontextImageScale',
        inputs: {
          image: ['1', 0],
        },
      },
      '3': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'qwen_image_edit_2511_int8_convrot.safetensors',
          weight_dtype: 'default',
        },
      },
      '4': {
        class_type: 'CLIPLoader',
        inputs: {
          clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
          type: 'qwen_image',
          device: 'default',
        },
      },
      '5': {
        class_type: 'VAELoader',
        inputs: {
          vae_name: 'qwen_image_vae.safetensors',
        },
      },
      '6': {
        class_type: 'ModelSamplingAuraFlow',
        inputs: {
          model: ['3', 0],
          shift: 3.1,
        },
      },
      '7': {
        class_type: 'CFGNorm',
        inputs: {
          model: ['6', 0],
          strength: 1.0,
          pre_cfg: false,
        },
      },
      '8': {
        class_type: 'LoraLoaderModelOnly',
        inputs: {
          model: ['7', 0],
          lora_name: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors',
          strength_model: 1.0,
        },
      },
      '9': {
        class_type: 'TextEncodeQwenImageEditPlus',
        inputs: {
          clip: ['4', 0],
          prompt: '{{prompt}}',
          vae: ['5', 0],
          image1: ['2', 0],
        },
      },
      '10': {
        class_type: 'TextEncodeQwenImageEditPlus',
        inputs: {
          clip: ['4', 0],
          prompt: '',
          vae: ['5', 0],
          image1: ['2', 0],
        },
      },
      '11': {
        class_type: 'FluxKontextMultiReferenceLatentMethod',
        inputs: {
          conditioning: ['9', 0],
          reference_latents_method: 'index_timestep_zero',
        },
      },
      '12': {
        class_type: 'FluxKontextMultiReferenceLatentMethod',
        inputs: {
          conditioning: ['10', 0],
          reference_latents_method: 'index_timestep_zero',
        },
      },
      '13': {
        class_type: 'VAEEncode',
        inputs: {
          pixels: ['2', 0],
          vae: ['5', 0],
        },
      },
      '14': {
        class_type: 'KSampler',
        inputs: {
          model: ['8', 0],
          positive: ['11', 0],
          negative: ['12', 0],
          latent_image: ['13', 0],
          seed: '{{seed}}',
          steps: 4,
          cfg: 1.0,
          sampler_name: 'euler',
          scheduler: 'simple',
          denoise: 1.0,
        },
      },
      '15': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['14', 0],
          vae: ['5', 0],
        },
      },
      '16': {
        class_type: 'SaveImage',
        inputs: {
          images: ['15', 0],
          filename_prefix: 'openshore/qwen-image-edit-2511',
        },
      },
    },
    placeholders: {
      prompt: ['9.prompt'],
      image: ['1.image'],
      seed: ['14.seed'],
    },
    minComfyVersion: '0.27.0',
    output: 'image',
  },
  'sam3:select': {
    graph: {
      '1': {
        class_type: 'LoadImage',
        inputs: {
          image: '{{image}}',
        },
      },
      '2': {
        class_type: 'CheckpointLoaderSimple',
        inputs: {
          ckpt_name: 'sam3.1_multiplex_fp16.safetensors',
        },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['2', 1],
          text: '{{prompt}}',
        },
      },
      '4': {
        class_type: 'SAM3_Detect',
        inputs: {
          model: ['2', 0],
          image: ['1', 0],
          conditioning: ['3', 0],
          threshold: 0.5,
          refine_iterations: 2,
          individual_masks: false,
        },
      },
      '5': {
        class_type: 'MaskToImage',
        inputs: {
          mask: ['4', 0],
        },
      },
      '6': {
        class_type: 'SaveImage',
        inputs: {
          images: ['5', 0],
          filename_prefix: 'openshore/sam3',
        },
      },
    },
    placeholders: {
      prompt: ['3.text'],
      image: ['1.image'],
    },
    minComfyVersion: '0.35.0',
    output: 'image',
  },
  'birefnet:background': {
    graph: {
      '1': {
        class_type: 'LoadImage',
        inputs: {
          image: '{{image}}',
        },
      },
      '2': {
        class_type: 'LoadBackgroundRemovalModel',
        inputs: {
          bg_removal_name: 'birefnet.safetensors',
        },
      },
      '3': {
        class_type: 'RemoveBackground',
        inputs: {
          bg_removal_model: ['2', 0],
          image: ['1', 0],
        },
      },
      '4': {
        class_type: 'InvertMask',
        inputs: {
          mask: ['3', 0],
        },
      },
      '5': {
        class_type: 'JoinImageWithAlpha',
        inputs: {
          image: ['1', 0],
          alpha: ['4', 0],
        },
      },
      '6': {
        class_type: 'SaveImage',
        inputs: {
          images: ['5', 0],
          filename_prefix: 'openshore/birefnet',
        },
      },
    },
    placeholders: {
      image: ['1.image'],
    },
    minComfyVersion: '0.24.0',
    output: 'image',
  },
  'esrgan:upscale': {
    graph: {
      '1': {
        class_type: 'LoadImage',
        inputs: {
          image: '{{image}}',
        },
      },
      '2': {
        class_type: 'UpscaleModelLoader',
        inputs: {
          model_name: 'RealESRGAN_x4plus.safetensors',
        },
      },
      '3': {
        class_type: 'ImageUpscaleWithModel',
        inputs: {
          upscale_model: ['2', 0],
          image: ['1', 0],
        },
      },
      '4': {
        class_type: 'SaveImage',
        inputs: {
          images: ['3', 0],
          filename_prefix: 'openshore/esrgan',
        },
      },
    },
    placeholders: {
      image: ['1.image'],
    },
    minComfyVersion: '0.3.31',
    output: 'image',
  },
  'seedvr2:upscale': {
    graph: {
      '1': {
        class_type: 'LoadImage',
        inputs: {
          image: '{{image}}',
        },
      },
      '2': {
        class_type: 'JoinImageWithAlpha',
        inputs: {
          image: ['1', 0],
          alpha: ['1', 1],
        },
      },
      '3': {
        class_type: 'ResizeImageMaskNode',
        inputs: {
          input: ['2', 0],
          resize_type: 'scale by multiplier',
          'resize_type.multiplier': 4.0,
          scale_method: 'lanczos',
        },
      },
      '4': {
        class_type: 'SeedVR2Preprocess',
        inputs: {
          resized_images: ['3', 0],
        },
      },
      '5': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'seedvr2_3b_int8_convrot.safetensors',
          weight_dtype: 'default',
        },
      },
      '6': {
        class_type: 'VAELoader',
        inputs: {
          vae_name: 'seedvr2_ema_vae_fp16.safetensors',
        },
      },
      '7': {
        class_type: 'VAEEncodeTiled',
        inputs: {
          pixels: ['4', 0],
          vae: ['6', 0],
          tile_size: 512,
          overlap: 128,
          temporal_size: 4096,
          temporal_overlap: 8,
        },
      },
      '8': {
        class_type: 'SeedVR2Conditioning',
        inputs: {
          model: ['5', 0],
          vae_conditioning: ['7', 0],
        },
      },
      '9': {
        class_type: 'KSampler',
        inputs: {
          model: ['5', 0],
          positive: ['8', 0],
          negative: ['8', 1],
          latent_image: ['7', 0],
          seed: '{{seed}}',
          steps: 1,
          cfg: 1.0,
          sampler_name: 'euler',
          scheduler: 'simple',
          denoise: 1.0,
        },
      },
      '10': {
        class_type: 'VAEDecodeTiled',
        inputs: {
          samples: ['9', 0],
          vae: ['6', 0],
          tile_size: 512,
          overlap: 128,
          temporal_size: 4096,
          temporal_overlap: 8,
        },
      },
      '11': {
        class_type: 'SeedVR2PostProcessing',
        inputs: {
          images: ['10', 0],
          original_resized_images: ['3', 0],
          color_correction_method: 'none',
        },
      },
      '12': {
        class_type: 'SaveImage',
        inputs: {
          images: ['11', 0],
          filename_prefix: 'openshore/seedvr2',
        },
      },
    },
    placeholders: {
      image: ['1.image'],
      seed: ['9.seed'],
    },
    minComfyVersion: '0.28.0',
    output: 'image',
  },
  'lama:remove': {
    graph: {
      '1': {
        class_type: 'LoadImage',
        inputs: {
          image: '{{image}}',
        },
      },
      '2': {
        class_type: 'LoadImageMask',
        inputs: {
          image: '{{mask}}',
          channel: 'red',
        },
      },
      '3': {
        class_type: 'INPAINT_LoadInpaintModel',
        inputs: {
          model_name: 'big-lama.pt',
        },
      },
      '4': {
        class_type: 'INPAINT_InpaintWithModel',
        inputs: {
          inpaint_model: ['3', 0],
          image: ['1', 0],
          mask: ['2', 0],
          seed: '{{seed}}',
        },
      },
      '5': {
        class_type: 'SaveImage',
        inputs: {
          images: ['4', 0],
          filename_prefix: 'openshore/lama',
        },
      },
    },
    placeholders: {
      image: ['1.image'],
      mask: ['2.image'],
      seed: ['4.seed'],
    },
    minComfyVersion: '0.3.31',
    output: 'image',
    nodePack: 'comfyui-inpaint-nodes',
  },
  'wan22-ti2v:text-to-video': {
    graph: {
      '1': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'wan2.2_ti2v_5B_fp16.safetensors',
          weight_dtype: 'default',
        },
      },
      '2': {
        class_type: 'CLIPLoader',
        inputs: {
          clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
          type: 'wan',
          device: 'default',
        },
      },
      '3': {
        class_type: 'VAELoader',
        inputs: {
          vae_name: 'wan2.2_vae.safetensors',
        },
      },
      '4': {
        class_type: 'ModelSamplingSD3',
        inputs: {
          model: ['1', 0],
          shift: 8.0,
        },
      },
      '5': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['2', 0],
          text: '{{prompt}}',
        },
      },
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['2', 0],
          text: '{{negative}}',
        },
      },
      '7': {
        class_type: 'Wan22ImageToVideoLatent',
        inputs: {
          vae: ['3', 0],
          width: 1280,
          height: 704,
          length: 121,
          batch_size: 1,
        },
      },
      '8': {
        class_type: 'KSampler',
        inputs: {
          model: ['4', 0],
          positive: ['5', 0],
          negative: ['6', 0],
          latent_image: ['7', 0],
          seed: '{{seed}}',
          steps: 20,
          cfg: 5.0,
          sampler_name: 'uni_pc',
          scheduler: 'simple',
          denoise: 1.0,
        },
      },
      '9': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['8', 0],
          vae: ['3', 0],
        },
      },
      '10': {
        class_type: 'CreateVideo',
        inputs: {
          images: ['9', 0],
          fps: 24.0,
        },
      },
      '11': {
        class_type: 'SaveVideo',
        inputs: {
          video: ['10', 0],
          filename_prefix: 'openshore/wan22-ti2v',
          format: 'mp4',
          'format.codec': 'auto',
          codec: 'auto',
        },
      },
    },
    placeholders: {
      prompt: ['5.text'],
      negative: ['6.text'],
      seed: ['8.seed'],
    },
    minComfyVersion: '0.3.46',
    output: 'video',
    defaults: {
      negative:
        '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走',
    },
  },
  'wan22-ti2v:image-to-video': {
    graph: {
      '1': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'wan2.2_ti2v_5B_fp16.safetensors',
          weight_dtype: 'default',
        },
      },
      '2': {
        class_type: 'CLIPLoader',
        inputs: {
          clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
          type: 'wan',
          device: 'default',
        },
      },
      '3': {
        class_type: 'VAELoader',
        inputs: {
          vae_name: 'wan2.2_vae.safetensors',
        },
      },
      '4': {
        class_type: 'ModelSamplingSD3',
        inputs: {
          model: ['1', 0],
          shift: 8.0,
        },
      },
      '5': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['2', 0],
          text: '{{prompt}}',
        },
      },
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['2', 0],
          text: '{{negative}}',
        },
      },
      '7': {
        class_type: 'Wan22ImageToVideoLatent',
        inputs: {
          vae: ['3', 0],
          width: 1280,
          height: 704,
          length: 121,
          batch_size: 1,
          start_image: ['12', 0],
        },
      },
      '8': {
        class_type: 'KSampler',
        inputs: {
          model: ['4', 0],
          positive: ['5', 0],
          negative: ['6', 0],
          latent_image: ['7', 0],
          seed: '{{seed}}',
          steps: 20,
          cfg: 5.0,
          sampler_name: 'uni_pc',
          scheduler: 'simple',
          denoise: 1.0,
        },
      },
      '9': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['8', 0],
          vae: ['3', 0],
        },
      },
      '10': {
        class_type: 'CreateVideo',
        inputs: {
          images: ['9', 0],
          fps: 24.0,
        },
      },
      '11': {
        class_type: 'SaveVideo',
        inputs: {
          video: ['10', 0],
          filename_prefix: 'openshore/wan22-ti2v',
          format: 'mp4',
          'format.codec': 'auto',
          codec: 'auto',
        },
      },
      '12': {
        class_type: 'LoadImage',
        inputs: {
          image: '{{image}}',
        },
      },
    },
    placeholders: {
      prompt: ['5.text'],
      negative: ['6.text'],
      seed: ['8.seed'],
      image: ['12.image'],
    },
    minComfyVersion: '0.3.46',
    output: 'video',
    defaults: {
      negative:
        '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走',
    },
  },
  'wan22-a14b:text-to-video': {
    graph: {
      '1': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
          weight_dtype: 'default',
        },
      },
      '2': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
          weight_dtype: 'default',
        },
      },
      '3': {
        class_type: 'CLIPLoader',
        inputs: {
          clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
          type: 'wan',
          device: 'default',
        },
      },
      '4': {
        class_type: 'VAELoader',
        inputs: {
          vae_name: 'wan_2.1_vae.safetensors',
        },
      },
      '5': {
        class_type: 'ModelSamplingSD3',
        inputs: {
          model: ['1', 0],
          shift: 5.0,
        },
      },
      '6': {
        class_type: 'ModelSamplingSD3',
        inputs: {
          model: ['2', 0],
          shift: 5.0,
        },
      },
      '7': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['3', 0],
          text: '{{prompt}}',
        },
      },
      '8': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['3', 0],
          text: '{{negative}}',
        },
      },
      '9': {
        class_type: 'EmptyHunyuanLatentVideo',
        inputs: {
          width: 640,
          height: 640,
          length: 81,
          batch_size: 1,
        },
      },
      '10': {
        class_type: 'KSamplerAdvanced',
        inputs: {
          model: ['5', 0],
          add_noise: 'enable',
          noise_seed: '{{seed}}',
          steps: 20,
          cfg: 3.5,
          sampler_name: 'euler',
          scheduler: 'simple',
          positive: ['7', 0],
          negative: ['8', 0],
          latent_image: ['9', 0],
          start_at_step: 0,
          end_at_step: 10,
          return_with_leftover_noise: 'enable',
        },
      },
      '11': {
        class_type: 'KSamplerAdvanced',
        inputs: {
          model: ['6', 0],
          add_noise: 'disable',
          noise_seed: 0,
          steps: 20,
          cfg: 3.5,
          sampler_name: 'euler',
          scheduler: 'simple',
          positive: ['7', 0],
          negative: ['8', 0],
          latent_image: ['10', 0],
          start_at_step: 10,
          end_at_step: 20,
          return_with_leftover_noise: 'disable',
        },
      },
      '12': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['11', 0],
          vae: ['4', 0],
        },
      },
      '13': {
        class_type: 'CreateVideo',
        inputs: {
          images: ['12', 0],
          fps: 16.0,
        },
      },
      '15': {
        class_type: 'SaveVideo',
        inputs: {
          video: ['13', 0],
          filename_prefix: 'openshore/wan22-a14b',
          format: 'mp4',
          'format.codec': 'auto',
          codec: 'auto',
        },
      },
    },
    placeholders: {
      prompt: ['7.text'],
      negative: ['8.text'],
      seed: ['10.noise_seed'],
    },
    minComfyVersion: '0.3.46',
    output: 'video',
    defaults: {
      negative:
        '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走，裸露，NSFW',
    },
  },
  'wan22-a14b:image-to-video': {
    graph: {
      '1': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
          weight_dtype: 'default',
        },
      },
      '2': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
          weight_dtype: 'default',
        },
      },
      '3': {
        class_type: 'CLIPLoader',
        inputs: {
          clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
          type: 'wan',
          device: 'default',
        },
      },
      '4': {
        class_type: 'VAELoader',
        inputs: {
          vae_name: 'wan_2.1_vae.safetensors',
        },
      },
      '5': {
        class_type: 'ModelSamplingSD3',
        inputs: {
          model: ['1', 0],
          shift: 5.0,
        },
      },
      '6': {
        class_type: 'ModelSamplingSD3',
        inputs: {
          model: ['2', 0],
          shift: 5.0,
        },
      },
      '7': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['3', 0],
          text: '{{prompt}}',
        },
      },
      '8': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['3', 0],
          text: '{{negative}}',
        },
      },
      '9': {
        class_type: 'WanImageToVideo',
        inputs: {
          positive: ['7', 0],
          negative: ['8', 0],
          vae: ['4', 0],
          width: 640,
          height: 640,
          length: 81,
          batch_size: 1,
          start_image: ['14', 0],
        },
      },
      '14': {
        class_type: 'LoadImage',
        inputs: {
          image: '{{image}}',
        },
      },
      '10': {
        class_type: 'KSamplerAdvanced',
        inputs: {
          model: ['5', 0],
          add_noise: 'enable',
          noise_seed: '{{seed}}',
          steps: 20,
          cfg: 3.5,
          sampler_name: 'euler',
          scheduler: 'simple',
          positive: ['9', 0],
          negative: ['9', 1],
          latent_image: ['9', 2],
          start_at_step: 0,
          end_at_step: 10,
          return_with_leftover_noise: 'enable',
        },
      },
      '11': {
        class_type: 'KSamplerAdvanced',
        inputs: {
          model: ['6', 0],
          add_noise: 'disable',
          noise_seed: 0,
          steps: 20,
          cfg: 3.5,
          sampler_name: 'euler',
          scheduler: 'simple',
          positive: ['9', 0],
          negative: ['9', 1],
          latent_image: ['10', 0],
          start_at_step: 10,
          end_at_step: 20,
          return_with_leftover_noise: 'disable',
        },
      },
      '12': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['11', 0],
          vae: ['4', 0],
        },
      },
      '13': {
        class_type: 'CreateVideo',
        inputs: {
          images: ['12', 0],
          fps: 16.0,
        },
      },
      '15': {
        class_type: 'SaveVideo',
        inputs: {
          video: ['13', 0],
          filename_prefix: 'openshore/wan22-a14b',
          format: 'mp4',
          'format.codec': 'auto',
          codec: 'auto',
        },
      },
    },
    placeholders: {
      prompt: ['7.text'],
      negative: ['8.text'],
      seed: ['10.noise_seed'],
      image: ['14.image'],
    },
    minComfyVersion: '0.3.46',
    output: 'video',
    defaults: {
      negative:
        '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走',
    },
  },
  'ace-step-15:music': {
    graph: {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: {
          ckpt_name: 'ace_step_1.5_turbo_aio.safetensors',
        },
      },
      '2': {
        class_type: 'ModelSamplingAuraFlow',
        inputs: {
          model: ['1', 0],
          shift: 3.0,
        },
      },
      '3': {
        class_type: 'TextEncodeAceStepAudio1.5',
        inputs: {
          clip: ['1', 1],
          tags: '{{tags}}',
          lyrics: '{{lyrics}}',
          seed: '{{seed}}',
          bpm: 190,
          duration: '{{seconds}}',
          timesignature: '4',
          language: 'en',
          keyscale: 'E minor',
          generate_audio_codes: true,
          cfg_scale: 2.0,
          temperature: 0.85,
          top_p: 0.9,
          top_k: 0,
          min_p: 0.0,
        },
      },
      '4': {
        class_type: 'ConditioningZeroOut',
        inputs: {
          conditioning: ['3', 0],
        },
      },
      '5': {
        class_type: 'EmptyAceStep1.5LatentAudio',
        inputs: {
          seconds: '{{seconds}}',
          batch_size: 1,
        },
      },
      '6': {
        class_type: 'KSampler',
        inputs: {
          model: ['2', 0],
          positive: ['3', 0],
          negative: ['4', 0],
          latent_image: ['5', 0],
          seed: '{{seed}}',
          steps: 8,
          cfg: 1.0,
          sampler_name: 'euler',
          scheduler: 'simple',
          denoise: 1.0,
        },
      },
      '7': {
        class_type: 'VAEDecodeAudio',
        inputs: {
          samples: ['6', 0],
          vae: ['1', 2],
        },
      },
      '8': {
        class_type: 'SaveAudioAdvanced',
        inputs: {
          audio: ['7', 0],
          filename_prefix: 'openshore/ace-step-15',
          format: 'flac',
        },
      },
    },
    placeholders: {
      tags: ['3.tags'],
      lyrics: ['3.lyrics'],
      seconds: ['3.duration', '5.seconds'],
      seed: ['3.seed', '6.seed'],
    },
    minComfyVersion: '0.28.0',
    output: 'audio',
    defaults: {
      seconds: 120,
    },
  },
  'ace-step-15-xl:music': {
    graph: {
      '1': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'acestep_v1.5_xl_turbo_bf16.safetensors',
          weight_dtype: 'default',
        },
      },
      '2': {
        class_type: 'DualCLIPLoader',
        inputs: {
          clip_name1: 'qwen_0.6b_ace15.safetensors',
          clip_name2: 'qwen_4b_ace15.safetensors',
          type: 'ace',
          device: 'default',
        },
      },
      '3': {
        class_type: 'VAELoader',
        inputs: {
          vae_name: 'ace_1.5_vae.safetensors',
        },
      },
      '4': {
        class_type: 'ModelSamplingAuraFlow',
        inputs: {
          model: ['1', 0],
          shift: 3.0,
        },
      },
      '5': {
        class_type: 'TextEncodeAceStepAudio1.5',
        inputs: {
          clip: ['2', 0],
          tags: '{{tags}}',
          lyrics: '{{lyrics}}',
          seed: '{{seed}}',
          bpm: 95,
          duration: '{{seconds}}',
          timesignature: '4',
          language: 'en',
          keyscale: 'E minor',
          generate_audio_codes: true,
          cfg_scale: 2.0,
          temperature: 0.85,
          top_p: 0.9,
          top_k: 0,
          min_p: 0.0,
        },
      },
      '6': {
        class_type: 'ConditioningZeroOut',
        inputs: {
          conditioning: ['5', 0],
        },
      },
      '7': {
        class_type: 'EmptyAceStep1.5LatentAudio',
        inputs: {
          seconds: '{{seconds}}',
          batch_size: 1,
        },
      },
      '8': {
        class_type: 'KSampler',
        inputs: {
          model: ['4', 0],
          positive: ['5', 0],
          negative: ['6', 0],
          latent_image: ['7', 0],
          seed: '{{seed}}',
          steps: 8,
          cfg: 1.0,
          sampler_name: 'euler',
          scheduler: 'simple',
          denoise: 1.0,
        },
      },
      '9': {
        class_type: 'VAEDecodeAudio',
        inputs: {
          samples: ['8', 0],
          vae: ['3', 0],
        },
      },
      '10': {
        class_type: 'SaveAudioAdvanced',
        inputs: {
          audio: ['9', 0],
          filename_prefix: 'openshore/ace-step-15-xl',
          format: 'mp3',
          'format.quality': 'V0',
        },
      },
    },
    placeholders: {
      tags: ['5.tags'],
      lyrics: ['5.lyrics'],
      seconds: ['5.duration', '7.seconds'],
      seed: ['5.seed', '8.seed'],
    },
    minComfyVersion: '0.28.0',
    output: 'audio',
    defaults: {
      seconds: 120,
    },
  },
  'stable-audio-3:effects': {
    graph: {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: {
          ckpt_name: 'stable_audio_3_medium.safetensors',
        },
      },
      '2': {
        class_type: 'CLIPLoader',
        inputs: {
          clip_name: 't5gemma_b_b_ul2.safetensors',
          type: 'stable_audio',
          device: 'default',
        },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['2', 0],
          text: '{{prompt}}',
        },
      },
      '4': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['2', 0],
          text: '',
        },
      },
      '5': {
        class_type: 'EmptyLatentAudio',
        inputs: {
          seconds: '{{seconds}}',
          batch_size: 1,
        },
      },
      '6': {
        class_type: 'KSampler',
        inputs: {
          model: ['1', 0],
          positive: ['3', 0],
          negative: ['4', 0],
          latent_image: ['5', 0],
          seed: '{{seed}}',
          steps: 8,
          cfg: 1.0,
          sampler_name: 'lcm',
          scheduler: 'simple',
          denoise: 1.0,
        },
      },
      '7': {
        class_type: 'VAEDecodeAudio',
        inputs: {
          samples: ['6', 0],
          vae: ['1', 2],
        },
      },
      '8': {
        class_type: 'SaveAudioAdvanced',
        inputs: {
          audio: ['7', 0],
          filename_prefix: 'openshore/stable-audio-3',
          format: 'mp3',
          'format.quality': 'V0',
        },
      },
    },
    placeholders: {
      prompt: ['3.text'],
      seconds: ['5.seconds'],
      seed: ['6.seed'],
    },
    minComfyVersion: '0.28.0',
    output: 'audio',
    defaults: {
      seconds: 10,
    },
  },
};
