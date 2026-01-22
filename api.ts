import { GenerationConfig, Task } from './types';

interface ApiResponse {
  data: Array<{
    url?: string;
    b64_json?: string;
  }>;
  error?: {
    message: string;
  };
}

export const generateImage = async (task: Task, config: GenerationConfig): Promise<string> => {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`
  };

  // Convert Base64 array to what the API expects
  // The spec says "image: array items: string (url or b64_json)"
  // We will assume b64_json is passed directly if available.
  
  const body = {
    model: config.model,
    prompt: task.prompt,
    response_format: 'url', // Or 'b64_json' if preferred for local
    aspect_ratio: config.aspectRatio,
    image_size: config.imageSize,
    image: task.referenceImages.length > 0 ? task.referenceImages : undefined
  };

  try {
    // Default to a common proxy endpoint if user doesn't specify one, 
    // but the UI requires a Base URL.
    const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/v1/images/generations`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });

    const data: ApiResponse = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || `HTTP Error ${response.status}`);
    }

    if (data.data && data.data.length > 0) {
      // Return URL or Base64
      return data.data[0].url || data.data[0].b64_json || '';
    } else {
      throw new Error('No image data returned from API');
    }

  } catch (error: any) {
    throw new Error(error.message || 'Unknown API Error');
  }
};