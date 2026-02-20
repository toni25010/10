export default async function handler(req, res) {
    // Настройка CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = req.body;

    // --- 1. ПОЛУЧЕНИЕ НОВОСТЕЙ (RSS Google News) ---
    if (body.action === 'getNews') {
        try {
            // Формируем запрос: Курс доллара, Нефть, ЦБ РФ
            const query = encodeURIComponent('курс доллара OR нефть OR ЦБ РФ');
            const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=ru&gl=RU&ceid=RU:ru`;
            
            const response = await fetch(rssUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SiBot/1.0)' }
            });
            
            const text = await response.text();
            const titles = [];
            const regex = /<title>(.*?)<\/title>/g;
            let match;
            let count = 0;
            
            // Парсим XML, берем первые 10 заголовков
            while ((match = regex.exec(text)) !== null && count < 10) {
                if (count > 0) { // Пропускаем заголовок самого канала
                    const title = match[1]
                        .replace(/&quot;/g, '"')
                        .replace(/&amp;/g, '&')
                        .replace(/&apos;/g, "'");
                    titles.push(`- ${title}`);
                }
                count++;
            }

            return res.status(200).json({ news: titles.join('\n') });

        } catch (error) {
            return res.status(200).json({ news: "Не удалось автоматически загрузить новости. Ошибка: " + error.message });
        }
    }

    // --- 2. ЗАПРОС К DEEPSEEK AI ---
    if (body.model && body.messages) {
        try {
            const response = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': req.headers.authorization
                },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            return res.status(response.status).json(data);
        } catch (error) {
            return res.status(500).json({ error: 'DeepSeek proxy error: ' + error.message });
        }
    }

    // --- 3. ДАННЫЕ С MOEX (Si-3.26 / SiH6) ---
    const { username, password, from, till } = body;
    try {
        let cookieHeader = '';
        
        // Авторизация (если переданы логин/пароль)
        if (username && password) {
            const authString = Buffer.from(`${username}:${password}`).toString('base64');
            const authResponse = await fetch('https://passport.moex.com/authenticate', {
                method: 'GET',
                headers: { 'Authorization': `Basic ${authString}` },
                redirect: 'manual' // Важно для получения куки
            });
            const setCookie = authResponse.headers.get('set-cookie');
            if (setCookie && setCookie.includes('MicexPassportCert')) {
                cookieHeader = setCookie.split(';')[0];
            }
        }

        // SiH6 - код для Si-3.26
        const moexUrl = `https://iss.moex.com/iss/engines/futures/markets/forts/securities/SiH6/candles.json?from=${from}&till=${till}&interval=60&iss.only=candles`;
        
        const headers = {};
        if (cookieHeader) headers['Cookie'] = cookieHeader;

        const dataResponse = await fetch(moexUrl, { headers });
        const data = await dataResponse.json();
        
        if (!data.candles || !data.candles.data || data.candles.data.length === 0) {
             return res.status(200).json({ warning: "Данные не получены. Возможно, контракт SiH6 еще не торгуется или неверные даты." });
        }

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
