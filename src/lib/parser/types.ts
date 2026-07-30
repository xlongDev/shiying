/**
 * 抖音解析领域模型类型定义。
 * 独立为子模块，供 parser 各子模块与业务层（组件 / API route / store）共享。
 */

export interface LivePhotoInfo {
  /** 静态高清原图 CDN URL */
  imageUrl: string;
  /** 无水印动态短片 CDN URL（2-4 秒 MP4） */
  videoUrl: string;
  /** BGM 背景音乐 CDN URL */
  musicUrl: string;
  /** 该实况照片在图片列表中的索引（混合图文场景） */
  index?: number;
}

export interface ParsedVideo {
  platform: "douyin";
  awemeId: string;
  desc: string;
  author: { name: string; avatar: string; uid?: string };
  cover: string;
  videoUrl: string;
  videoUrlWithWatermark?: string;
  videoUrlPlay?: string;
  musicUrl?: string;
  hasMusic?: boolean;
  duration?: number;
  stats?: { likeCount?: number; commentCount?: number; shareCount?: number };
  images?: string[];
  isImagePost?: boolean;
  /** 内容类型：video 普通视频，note 图文帖，slides 混合图文 */
  contentType?: "video" | "note" | "slides";
  /** 是否为实况照片帖子（单图实况） */
  isLivePhoto?: boolean;
  /** 单图实况照片三套资源（仅单图实况帖存在） */
  livePhoto?: LivePhotoInfo;
  /** 是否为混合图文+实况帖子（slides 类型，含普通图+实况图） */
  isMixedLivePhoto?: boolean;
  /** 混合图文中的多实况照片数组（仅 slides 类型存在） */
  livePhotos?: LivePhotoInfo[];
  /** 实况照片资源是否仍在异步解析中（前端用于骨架屏显示） */
  livePhotoPending?: boolean;
  /**
   * 实况照片后台静默探测标记。
   * 与 livePhotoPending 的区别：后台探测不展示「探测中」骨架屏、探测失败也不展示
   * 「探测未完成」重试面板，仅在确实找到实况资源时才展示实况 UI。
   * 用于普通图文帖（含多图 note），避免对不含实况的普通帖子误报。
   */
  livePhotoBackground?: boolean;
  /** 实况照片异步探测是否已尝试但仍未获取到（前端用于展示「重试」入口，避免静默降级为普通图片） */
  livePhotoFailed?: boolean;
  raw?: unknown;
}

export class ParseError extends Error {
  constructor(
    message: string,
    public code: string = "PARSE_ERROR"
  ) {
    super(message);
  }
}
