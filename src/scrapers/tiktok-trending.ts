import { Parser } from "htmlparser2";
import { getSharedSession } from "../http.ts";
import { RETRY } from "../config.ts";
import { type TrendingVideo, type TrendingResult } from "../types.ts";
import { logger as rootLogger } from "../logger.ts";

const logger = rootLogger.child({ module: "scrape:trending" });

const TIKTOK_TRENDING_URL = "https://www.tiktok.com/api/explore/item_list/";

const DEFAULT_HEADERS: Record<string, string> = {
	Accept: "application/json, text/plain, */*",
	"Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
	Referer: "https://www.tiktok.com/explore",
	"User-Agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
};

interface TikTokItemStats {
	readonly playCount?: number;
	readonly diggCount?: number;
	readonly commentCount?: number;
	readonly shareCount?: number;
}

interface TikTokAuthor {
	readonly uniqueId?: string;
	readonly nickname?: string;
}

interface TikTokMusic {
	readonly title?: string;
}

interface TikTokVideo {
	readonly duration?: number;
}

interface TikTokItem {
	readonly id?: string;
	readonly desc?: string;
	readonly createTime?: number;
	readonly author?: TikTokAuthor;
	readonly stats?: TikTokItemStats;
	readonly music?: TikTokMusic;
	readonly video?: TikTokVideo;
}

interface TikTokExploreResponse {
	readonly itemList?: readonly TikTokItem[];
	readonly hasMore?: boolean;
	readonly cursor?: string;
	readonly statusCode?: number;
}

function buildExploreUrl(region: string, count: number, cursor: string): string {
	const params = new URLSearchParams({
		WebIdLastTime: String(Math.floor(Date.now() / 1000)),
		aid: "1988",
		app_language: "ru-RU",
		app_name: "tiktok_web",
		browser_language: "ru-RU",
		browser_name: "Mozilla",
		browser_online: "true",
		browser_platform: "Win32",
		browser_version: "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
		categoryType: "119",
		channel: "tiktok_web",
		cookie_enabled: "true",
		count: String(count),
		cursor,
		device_id: String(Math.floor(Math.random() * 9_000_000_000_000_000_000) + 1_000_000_000_000_000_000),
		device_platform: "web_pc",
		language: "ru-RU",
		os: "windows",
		priority_region: "",
		region,
		screen_height: "1080",
		screen_width: "1920",
		tz_name: "Europe/Moscow",
	});
	return `${TIKTOK_TRENDING_URL}?${params.toString()}`;
}

function parseItem(item: TikTokItem): TrendingVideo | undefined {
	if (!item.id) return undefined;

	const author = item.author?.uniqueId ?? "unknown";
	const authorNickname = item.author?.nickname ?? author;

	return {
		id: item.id,
		description: item.desc ?? "",
		author,
		authorNickname,
		plays: item.stats?.playCount ?? 0,
		likes: item.stats?.diggCount ?? 0,
		comments: item.stats?.commentCount ?? 0,
		shares: item.stats?.shareCount ?? 0,
		duration: item.video?.duration ?? 0,
		createTime: item.createTime ?? 0,
		url: `https://www.tiktok.com/@${author}/video/${item.id}`,
		musicTitle: item.music?.title ?? "",
	};
}

function extractSigiState(html: string): TikTokItem[] {
	let scriptContent = "";
	let isScript = false;
	let isSigi = false;

	const parser = new Parser({
		onopentagname(name) {
			isScript = name === "script";
			scriptContent = "";
			isSigi = false;
		},
		onattribute(name, value) {
			if (isScript && name === "id" && value === "SIGI_STATE") {
				isSigi = true;
			}
			if (isScript && name === "id" && value === "__UNIVERSAL_DATA_FOR_REHYDRATION__") {
				isSigi = true;
			}
		},
		ontext(text) {
			if (isScript && isSigi) scriptContent += text;
		},
		onclosetag(name) {
			if (name === "script") {
				isScript = false;
			}
		},
	});

	parser.write(html);
	parser.end();

	if (!scriptContent) return [];

	try {
		const data = JSON.parse(scriptContent) as Record<string, unknown>;

		const defaultScope = data["__DEFAULT_SCOPE__"] as Record<string, unknown> | undefined;
		if (defaultScope) {
			const exploreData = defaultScope["webapp.explore-data"] as Record<string, unknown> | undefined;
			if (exploreData) {
				const itemList = exploreData["itemList"] as TikTokItem[] | undefined;
				if (itemList) return itemList;
			}
		}

		const itemModule = data["ItemModule"] as Record<string, TikTokItem> | undefined;
		if (itemModule) return Object.values(itemModule);

		return [];
	} catch (e) {
		logger.debug({ err: e }, "failed to parse SIGI_STATE");
		return [];
	}
}

export async function fetchTrendingVideos(region: string, count: number): Promise<TrendingResult> {
	const session = await getSharedSession();
	const videos: TrendingVideo[] = [];

	logger.info({ region, count }, "fetching trending videos via API");
	const apiUrl = buildExploreUrl(region, Math.min(count, 30), "0");
	logger.debug({ url: apiUrl }, "requesting explore API");

	try {
		const res = await session.fetch(apiUrl, { headers: DEFAULT_HEADERS });

		if (res.ok) {
			const data = (await res.json()) as TikTokExploreResponse;
			logger.debug({ itemCount: data.itemList?.length ?? 0, statusCode: data.statusCode }, "API response");

			if (data.itemList) {
				for (const item of data.itemList) {
					const video = parseItem(item);
					if (video) videos.push(video);
					if (videos.length >= count) break;
				}
			}
		} else {
			logger.warn({ status: res.status }, "API request failed, falling back to web scraping");
		}
	} catch (e) {
		logger.warn({ err: e }, "API request error, falling back to web scraping");
	}

	if (videos.length === 0) {
		logger.info("falling back to web scraping for trending videos");
		const webUrl = `https://www.tiktok.com/explore?lang=ru-RU&region=${region}`;

		let lastError: Error | undefined;
		let delayMs: number = RETRY.initialDelayMs;

		for (let attempt = 0; attempt < RETRY.maxAttempts; attempt++) {
			try {
				const res = await session.fetch(webUrl, { headers: DEFAULT_HEADERS });
				if (res.ok) {
					const html = await res.text();
					const items = extractSigiState(html);
					logger.debug({ itemCount: items.length }, "extracted items from HTML");

					for (const item of items) {
						const video = parseItem(item);
						if (video) videos.push(video);
						if (videos.length >= count) break;
					}

					if (videos.length > 0) break;
				}
				lastError = new Error(`HTTP ${res.status}`);
			} catch (e) {
				lastError = e instanceof Error ? e : new Error(String(e));
				logger.warn({ attempt: attempt + 1, err: lastError }, "web scraping attempt failed");
			}

			if (attempt + 1 < RETRY.maxAttempts) {
				const jitter = Math.floor(Math.random() * 1001);
				const sleepMs = delayMs + jitter;
				logger.debug({ sleepMs }, "backing off before retry");
				await Bun.sleep(sleepMs);
				delayMs = Math.min(delayMs * 2, RETRY.maxDelayMs);
			}
		}

		if (videos.length === 0 && lastError) {
			logger.warn({ err: lastError }, "all scraping attempts failed");
		}
	}

	return {
		region,
		videos,
		fetchedAt: new Date().toISOString(),
	};
}
