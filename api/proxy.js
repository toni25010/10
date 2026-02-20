export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = req.body;

    // 1. GET LAST TRADE (Realtime Price)
    if (body.action === 'getLastTrade') {
        try {
            const url = `https://iss.moex.com/iss/engines/futures/markets/forts/securities/SiH6/trades.json?reverse=true&limit=1`;
            const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const data = await response.json();
            const cols = data.trades.columns;
            const row = data.trades.data[0];
            if (!row) throw new Error("No trades");
            return res.status(200).json({ 
                price: parseFloat(row[cols.indexOf('price')]), 
                time: row[cols.indexOf('tradetime')]
            });
        } catch (error) {
            return res.status(200).json({ price: null });
        }
    }

    // 2. GET NEWS
    if (body.action === 'getNews') {
        try {
            const query = encodeURIComponent('курс доллара OR нефть OR ЦБ РФ');
            const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=ru&gl=RU&ceid=RU:ru`;
            const response = await fetch(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const text = await response.text();
            const titles = [];
            const regex = /<title>(.*?)<\/title>/g;
            let match; let count = 0;
            while ((match = regex.exec(text)) !== null && count < 10) {
                if (count > 0) titles.push(`- ${match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')}`);
                count++;
            }
            return res.status(200).json({ news: titles.join('\n') });
        } catch (error) {
            return res.status(200).json({ news: "Ошибка загрузки" });
        }
    }

    // 3. DEEPSEEK
    if (body.model && body.messages) {
        try {
            const response = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': req.headers.authorization },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            return res.status(response.status).json(data);
        } catch (error) {
            return res.status(500).json({ error: 'DeepSeek error' });
        }
    }

    // 4. MOEX DATA
    const { username, password, from, till, interval = 60 } = body;
    try {
        let cookieHeader = '';
        if (username && password) {
            const authString = Buffer.from(`${username}:${password}`).toString('base64');
            const authResponse = await fetch('https://passport.moex.com/authenticate', {
                method: 'GET',
                headers: { 'Authorization': `Basic ${authString}` },
                redirect: 'manual'
            });
            const setCookie = authResponse.headers.get('set-cookie');
            if (setCookie && setCookie.includes('MicexPassportCert')) cookieHeader = setCookie.split(';')[0];
        }

        const moexUrl = `https://iss.moex.com/iss/engines/futures/markets/forts/securities/SiH6/candles.json?from=${from}&till=${till}&interval=${interval}&iss.only=candles`;
        const headers = {};
        if (cookieHeader) headers['Cookie'] = cookieHeader;

        const dataResponse = await fetch(moexUrl, { headers });
        const data = await dataResponse.json();
        if (!data.candles || !data.candles.data || data.candles.data.length === 0) {
             return res.status(200).json({ warning: "Нет данных" });
        }
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
