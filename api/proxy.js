export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = req.body;

    // --- 1. ПОЛУЧЕНИЕ НОВОСТЕЙ (RSS) ---
    if (body.action === 'getNews') {
        try {
            // Ищем новости по запросу: Курс доллара, Нефть, ЦБ РФ
            const query = encodeURIComponent('курс доллара OR нефть OR ЦБ РФ');
            // Используем Google News RSS (надежный источник)
            const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=ru&gl=RU&ceid=RU:ru`;
            
            const response = await fetch(rssUrl, {
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (compatible; SiBot/1.0)' 
                }
            });
            
            const text = await response.text();
            
            // Простой парсинг XML без библиотек (вытаскиваем заголовки)
            const titles = [];
            const regex = /<title>(.*?)<\/title>/g;
            let match;
            let count = 0;
            
            while ((match = regex.exec(text)) !== null && count < 10) {
                // Пропускаем технический заголовок самой ленты
                if (count > 0) { 
                    // Декодируем HTML сущности (например, &amp; -> &)
                    const title = match[1]
                        .replace(/&quot;/g, '"')
                        .replace(/&amp;/g, '&')
                        .replace(/&apos;/g, "'")
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>');
                    titles.push(`- ${title}`);
                }
                count++;
            }

            return res.status(200).json({ news: titles.join('\n') });

        } catch (error) {
            return res.status(200).json({ news: "Не удалось загрузить новости автоматически. Ошибка: " + error.message });
        }
    }

    // --- 2. ЗАПРОС К DEEPSEEK ---
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
            return res.status(500).json({ error: 'DeepSeek error: ' + error.message });
        }
    }

    // --- 3. ДАННЫЕ MOEX ---
    const { username, password, from, till } = body;
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
            if (setCookie && setCookie.includes('MicexPassportCert')) {
                cookieHeader = setCookie.split(';')[0];
            }
        }

        const moexUrl = `https://iss.moex.com/iss/engines/futures/markets/forts/securities/SiH6/candles.json?from=${from}&till=${till}&interval=60&iss.only=candles`;
        
        const headers = {};
        if (cookieHeader) headers['Cookie'] = cookieHeader;

        const dataResponse = await fetch(moexUrl, { headers });
        const data = await dataResponse.json();
        
        if (!data.candles || !data.candles.data || data.candles.data.length === 0) {
             return res.status(200).json({ warning: "Данные MOEX не получены. Проверьте даты или логин." });
        }

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
