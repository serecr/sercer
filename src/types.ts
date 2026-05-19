export const DOWNLOAD_TYPES = ["mod", "plugin"] as const;
export type DownloadType = (typeof DOWNLOAD_TYPES)[number];

export interface DownloadInfo {
	readonly fileName: string;
	readonly fileSize: number;
	readonly fileMime: string;
	readonly links: readonly string[];
}

export interface TrendingVideo {
	readonly id: string;
	readonly description: string;
	readonly author: string;
	readonly authorNickname: string;
	readonly plays: number;
	readonly likes: number;
	readonly comments: number;
	readonly shares: number;
	readonly duration: number;
	readonly createTime: number;
	readonly url: string;
	readonly musicTitle: string;
}

export interface TrendingResult {
	readonly region: string;
	readonly videos: readonly TrendingVideo[];
	readonly fetchedAt: string;
}
