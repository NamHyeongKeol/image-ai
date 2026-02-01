import { router, publicProcedure } from '../trpc';
import { z } from 'zod';

export const appRouter = router({
  // 헬스 체크
  health: publicProcedure.query(() => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }),
  
  // 이미지 처리 기록 (DB 없이 메모리에 저장)
  processImage: publicProcedure
    .input(z.object({
      filename: z.string(),
      faceCount: z.number(),
      mosaicStrength: z.number(),
    }))
    .mutation(async ({ input }) => {
      // DB 없이 로그만 출력
      console.log(`[Mosaic] Processed: ${input.filename}, Faces: ${input.faceCount}, Strength: ${input.mosaicStrength}`);
      return {
        success: true,
        message: `${input.faceCount}개의 얼굴에 모자이크 처리 완료`,
        processedAt: new Date().toISOString(),
      };
    }),
});

export type AppRouter = typeof appRouter;
