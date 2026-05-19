import { fetchTrendingVideos } from "./scrapers/tiktok-trending.ts";
import { logger as rootLogger } from "./logger.ts";

const logger = rootLogger.child({ module: "trending" });

function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

function formatDuration(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatTimestamp(unixSeconds: number): string {
	if (!unixSeconds) return "N/A";
	return new Date(unixSeconds * 1000).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
}

export async function handleTrending(region: string, count: number, jsonOutput: boolean): Promise<void> {
	logger.info({ region, count }, "fetching trending videos");

	const result = await fetchTrendingVideos(region, count);

	if (jsonOutput) {
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	if (result.videos.length === 0) {
		logger.warn({ region }, "no trending videos found");
		console.log(`\nНе удалось найти трендовые видео для региона ${region}.`);
		console.log("TikTok может блокировать запросы. Попробуйте позже или используйте --json для отладки.\n");
		return;
	}

	console.log(`\n🇷🇺 Новые трендовые видео TikTok — регион: ${region}`);
	console.log(`📅 Время запроса: ${result.fetchedAt}`);
	console.log(`📊 Найдено видео: ${result.videos.length}`);
	console.log("─".repeat(80));

	for (const [index, video] of result.videos.entries()) {
		const num = String(index + 1).padStart(2, " ");
		const desc = video.description.length > 60 ? `${video.description.slice(0, 57)}...` : video.description;

		console.log(`\n${num}. ${desc || "(без описания)"}`);
		console.log(`    👤 @${video.author} (${video.authorNickname})`);
		console.log(
			`    👁 ${formatNumber(video.plays)}  ❤ ${formatNumber(video.likes)}  💬 ${formatNumber(video.comments)}  ↗ ${formatNumber(video.shares)}`,
		);
		console.log(`    ⏱ ${formatDuration(video.duration)}  🕐 ${formatTimestamp(video.createTime)}`);
		if (video.musicTitle) {
			console.log(`    🎵 ${video.musicTitle}`);
		}
		console.log(`    🔗 ${video.url}`);
	}

	console.log("\n" + "─".repeat(80));
	console.log(`Всего: ${result.videos.length} видео из региона ${region}\n`);
}
