export interface YouTubeSearchResult {
  title: string;
  youtubeId: string;
}

export async function searchYouTube(query: string): Promise<YouTubeSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const html = await res.text();
    const results: YouTubeSearchResult[] = [];
    const seen = new Set<string>();
    const regex = /"videoId":"([A-Za-z0-9_-]{11})".*?"title":\{"runs":\[\{"text":"([^"]+)"\}/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null && results.length < 8) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        results.push({ youtubeId: m[1], title: m[2] });
      }
    }
    return results;
  } catch {
    return [];
  }
}

export async function fetchYouTubePlaylist(listId: string, videoId?: string): Promise<YouTubeSearchResult[]> {
  const cleanList = listId.trim();
  if (!cleanList) return [];
  try {
    const targetUrl =
      cleanList.startsWith('RD') && videoId
        ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&list=${encodeURIComponent(cleanList)}`
        : `https://www.youtube.com/playlist?list=${encodeURIComponent(cleanList)}`;
    const res = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const html = await res.text();
    const results: YouTubeSearchResult[] = [];
    const seen = new Set<string>();
    const regex = /"playlistVideoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})".*?"title":\{"runs":\[\{"text":"([^"]+)"\}/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null && results.length < 30) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        results.push({ youtubeId: m[1], title: m[2] });
      }
    }
    if (results.length === 0) {
      const panelRegex =
        /"playlistPanelVideoRenderer":\{"title":\{"accessibility":\{"accessibilityData":\{"label":"[^"]+"\}\},"simpleText":"([^"]+)"\}.*?"videoId":"([A-Za-z0-9_-]{11})"/g;
      while ((m = panelRegex.exec(html)) !== null && results.length < 30) {
        if (!seen.has(m[2])) {
          seen.add(m[2]);
          results.push({ youtubeId: m[2], title: m[1] });
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}
