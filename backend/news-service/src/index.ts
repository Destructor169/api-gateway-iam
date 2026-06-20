import express from 'express';
import axios from 'axios';
import Sentiment from 'sentiment';
import NodeCache from 'node-cache';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3003;
const sentiment = new Sentiment();
const cache = new NodeCache({ stdTTL: 300 }); // 5 min default cache

// ──────────────────────────────────────
// GET /sentiment — Trending tech news (Hacker News, no key required)
// ──────────────────────────────────────
app.get('/sentiment', async (req, res) => {
    try {
        const cached = cache.get('hn_sentiment');
        if (cached) return res.json(cached);

        console.log('Fetching news from Hacker News...');
        const topStoriesRes = await axios.get('https://hacker-news.firebaseio.com/v0/topstories.json');
        const topStoryIds = topStoriesRes.data.slice(0, 15);

        const posts = await Promise.all(
            topStoryIds.map(async (id: number) => {
                const storyRes = await axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
                return storyRes.data;
            })
        );
        
        const analyzedPosts = posts.filter((p: any) => p && p.title).map((post: any) => {
            const title = post.title;
            const result = sentiment.analyze(title);
            
            let mood = 'Neutral';
            if (result.score > 0) mood = 'Positive';
            if (result.score < 0) mood = 'Negative';

            return {
                title,
                score: result.score,
                mood,
                url: post.url || `https://news.ycombinator.com/item?id=${post.id}`,
                time: new Date(post.time * 1000).toISOString()
            };
        });

        const overallScore = analyzedPosts.reduce((acc: number, curr: any) => acc + curr.score, 0);
        let overallMood = 'Neutral';
        if (overallScore > 0) overallMood = 'Positive';
        if (overallScore < 0) overallMood = 'Negative';

        const payload = {
            source: 'Hacker News',
            timestamp: new Date().toISOString(),
            overall_sentiment: { total_score: overallScore, mood: overallMood },
            articles: analyzedPosts
        };

        cache.set('hn_sentiment', payload);
        res.json(payload);

    } catch (error: any) {
        console.error('Error fetching HN data:', error.message);
        res.status(500).json({ error: 'Failed to fetch news data' });
    }
});

// ──────────────────────────────────────
// GET /search?q=keyword — Keyword news search (GNews API)
// ──────────────────────────────────────
app.get('/search', async (req, res) => {
    const query = req.query.q as string;
    const apiKey = req.headers['x-gnews-api-key'] as string;

    if (!query) {
        return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    if (!apiKey) {
        return res.status(400).json({ error: 'GNews API key is required. Please configure it in Settings.' });
    }

    try {
        const cacheKey = `gnews_${query.toLowerCase().replace(/\s+/g, '_')}`;
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);

        console.log(`Searching GNews for: "${query}"`);
        const response = await axios.get('https://gnews.io/api/v4/search', {
            params: {
                q: query,
                lang: 'en',
                max: 10,
                token: apiKey
            }
        });

        const articles = response.data.articles || [];
        const analyzedArticles = articles.map((article: any) => {
            const text = `${article.title} ${article.description || ''}`;
            const result = sentiment.analyze(text);
            
            let mood = 'Neutral';
            if (result.score > 0) mood = 'Positive';
            if (result.score < 0) mood = 'Negative';

            return {
                title: article.title,
                description: article.description,
                url: article.url,
                image: article.image,
                publishedAt: article.publishedAt,
                source: article.source?.name || 'Unknown',
                sentiment_score: result.score,
                mood
            };
        });

        const overallScore = analyzedArticles.reduce((acc: number, curr: any) => acc + curr.sentiment_score, 0);
        let overallMood = 'Neutral';
        if (overallScore > 0) overallMood = 'Positive';
        if (overallScore < 0) overallMood = 'Negative';

        const payload = {
            source: 'GNews',
            query,
            timestamp: new Date().toISOString(),
            overall_sentiment: { total_score: overallScore, mood: overallMood },
            total_results: analyzedArticles.length,
            articles: analyzedArticles
        };

        cache.set(cacheKey, payload, 600); // cache 10 min
        res.json(payload);

    } catch (error: any) {
        console.error('Error searching GNews:', error.message);
        if (error.response?.status === 403) {
            return res.status(403).json({ error: 'Invalid or expired GNews API key' });
        }
        res.status(500).json({ error: 'Failed to search news' });
    }
});

// ──────────────────────────────────────
// GET /topic/:symbol — News for a specific stock/crypto
// ──────────────────────────────────────
app.get('/topic/:symbol', async (req, res) => {
    const symbol = req.params.symbol;
    const apiKey = req.headers['x-gnews-api-key'] as string;

    if (!apiKey) {
        // Fallback: use Hacker News search
        try {
            const cacheKey = `hn_topic_${symbol}`;
            const cached = cache.get(cacheKey);
            if (cached) return res.json(cached);

            const response = await axios.get(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(symbol)}&tags=story&hitsPerPage=10`);
            const articles = (response.data.hits || []).map((hit: any) => {
                const result = sentiment.analyze(hit.title);
                let mood = 'Neutral';
                if (result.score > 0) mood = 'Positive';
                if (result.score < 0) mood = 'Negative';

                return {
                    title: hit.title,
                    url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
                    publishedAt: hit.created_at,
                    source: 'Hacker News',
                    sentiment_score: result.score,
                    mood
                };
            });

            const payload = {
                source: 'Hacker News (fallback)',
                symbol,
                timestamp: new Date().toISOString(),
                articles
            };

            cache.set(cacheKey, payload, 600);
            return res.json(payload);
        } catch (error: any) {
            console.error('Error fetching HN topic:', error.message);
            return res.status(500).json({ error: 'Failed to fetch topic news' });
        }
    }

    // Use GNews for topic search
    try {
        const cacheKey = `gnews_topic_${symbol}`;
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);

        const response = await axios.get('https://gnews.io/api/v4/search', {
            params: {
                q: symbol,
                lang: 'en',
                max: 10,
                token: apiKey
            }
        });

        const articles = (response.data.articles || []).map((article: any) => {
            const text = `${article.title} ${article.description || ''}`;
            const result = sentiment.analyze(text);
            let mood = 'Neutral';
            if (result.score > 0) mood = 'Positive';
            if (result.score < 0) mood = 'Negative';

            return {
                title: article.title,
                description: article.description,
                url: article.url,
                image: article.image,
                publishedAt: article.publishedAt,
                source: article.source?.name || 'Unknown',
                sentiment_score: result.score,
                mood
            };
        });

        const payload = {
            source: 'GNews',
            symbol,
            timestamp: new Date().toISOString(),
            articles
        };

        cache.set(cacheKey, payload, 600);
        res.json(payload);

    } catch (error: any) {
        console.error('Error fetching topic news:', error.message);
        res.status(500).json({ error: 'Failed to fetch topic news' });
    }
});

app.listen(PORT, () => {
    console.log(`News service running on port ${PORT}`);
});
