'use client';

/**
 * Apply pixelation mosaic effect to a circular brush area
 */
export function applyBrushMosaic(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  brushSize: number, // This determines both area and block size
  canvasWidth: number,
  canvasHeight: number
): void {
  // Block size is proportional to brush size (bigger brush = stronger mosaic)
  const blockSize = Math.max(3, Math.floor(brushSize / 3));
  
  // Calculate brush bounds
  const radius = brushSize / 2;
  const startX = Math.max(0, Math.floor(centerX - radius));
  const startY = Math.max(0, Math.floor(centerY - radius));
  const endX = Math.min(canvasWidth, Math.ceil(centerX + radius));
  const endY = Math.min(canvasHeight, Math.ceil(centerY + radius));
  
  const width = endX - startX;
  const height = endY - startY;
  
  if (width <= 0 || height <= 0) return;
  
  // Get the image data for the brush region
  const imageData = ctx.getImageData(startX, startY, width, height);
  const data = imageData.data;
  
  // Apply pixelation only within the circular brush area
  for (let by = 0; by < height; by += blockSize) {
    for (let bx = 0; bx < width; bx += blockSize) {
      // Check if block center is within the circular brush
      const blockCenterX = startX + bx + blockSize / 2;
      const blockCenterY = startY + by + blockSize / 2;
      const distFromCenter = Math.sqrt(
        Math.pow(blockCenterX - centerX, 2) + Math.pow(blockCenterY - centerY, 2)
      );
      
      if (distFromCenter > radius) continue;
      
      let r = 0, g = 0, b = 0, count = 0;
      
      const blockW = Math.min(blockSize, width - bx);
      const blockH = Math.min(blockSize, height - by);
      
      // Calculate average color for this block
      for (let py = 0; py < blockH; py++) {
        for (let px = 0; px < blockW; px++) {
          const pixelX = bx + px;
          const pixelY = by + py;
          
          // Check if this pixel is within the circular brush
          const pixelWorldX = startX + pixelX;
          const pixelWorldY = startY + pixelY;
          const pixelDist = Math.sqrt(
            Math.pow(pixelWorldX - centerX, 2) + Math.pow(pixelWorldY - centerY, 2)
          );
          
          if (pixelDist <= radius) {
            const i = (pixelY * width + pixelX) * 4;
            if (i >= 0 && i < data.length) {
              r += data[i];
              g += data[i + 1];
              b += data[i + 2];
              count++;
            }
          }
        }
      }
      
      if (count > 0) {
        r = Math.floor(r / count);
        g = Math.floor(g / count);
        b = Math.floor(b / count);
        
        // Fill block with average color (only pixels within the brush)
        for (let py = 0; py < blockH; py++) {
          for (let px = 0; px < blockW; px++) {
            const pixelX = bx + px;
            const pixelY = by + py;
            
            const pixelWorldX = startX + pixelX;
            const pixelWorldY = startY + pixelY;
            const pixelDist = Math.sqrt(
              Math.pow(pixelWorldX - centerX, 2) + Math.pow(pixelWorldY - centerY, 2)
            );
            
            if (pixelDist <= radius) {
              const i = (pixelY * width + pixelX) * 4;
              if (i >= 0 && i < data.length) {
                data[i] = r;
                data[i + 1] = g;
                data[i + 2] = b;
              }
            }
          }
        }
      }
    }
  }
  
  ctx.putImageData(imageData, startX, startY);
}
