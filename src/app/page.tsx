"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AuroraBackground } from "@/components/aurora-background";
import { Header } from "@/components/header";
import { UrlInput } from "@/components/url-input";
import { VideoResult } from "@/components/video-result";
import { ParseSkeleton } from "@/components/parse-skeleton";
import { FeaturesSection } from "@/components/features-section";
import { StepsSection } from "@/components/steps-section";
import { Footer } from "@/components/footer";
import { FaqSection } from "@/components/faq-section";
import { useParseVideo } from "@/hooks/use-parse-video";

export default function Home() {
  const resultRef = React.useRef<HTMLDivElement>(null);
  const { loading, video, lastUrl, handleParse, retryLivePhoto } = useParseVideo(resultRef);

  return (
    <div className="relative min-h-screen flex flex-col">
      <AuroraBackground />
      <Header onSelectHistory={handleParse} />

      <main className="flex-1 w-full">
        {/* Hero + 输入 + 结果 */}
        <section className="mx-auto max-w-4xl px-5 sm:px-8 pt-12 sm:pt-20 pb-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="text-center mb-8"
          >
            <motion.h1
              className="text-4xl sm:text-6xl font-bold tracking-tight mb-5 leading-[1.05]"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.5 }}
            >
              <span className="text-gradient">抖音</span>
              <br />
              无水印下载
            </motion.h1>
            <motion.div
              className="max-w-2xl mx-auto space-y-1 sm:space-y-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <p className="text-base sm:text-lg md:text-xl font-medium text-foreground leading-snug">
                视频 · 图文 · 实况照片 · BGM
              </p>
              <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                粘贴抖音链接，全部高清无水印
              </p>
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
          >
            <UrlInput onParse={handleParse} loading={loading} externalUrl={lastUrl} />
          </motion.div>

          <div ref={resultRef} className="mt-8">
            <AnimatePresence mode="wait">
              {loading && <ParseSkeleton key="skeleton" />}
              {video && !loading && (
                <VideoResult
                  key={video.awemeId}
                  video={video}
                  onRetryLivePhoto={() => video && retryLivePhoto(video)}
                />
              )}
            </AnimatePresence>
          </div>
        </section>

        <StepsSection />
        <FeaturesSection />
        <FaqSection />
      </main>

      <Footer />
    </div>
  );
}
