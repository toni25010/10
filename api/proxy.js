// api/proxy.js
export default async function handler(req, res) {
    // Разрешаем CORS для фронтенда
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { username, password, from, till } = req.body;
    if (!username || !password || !from || !till) {
        return res.status(400).json({ error: 'Missing username, password, from or till' });
    }

    try {
        // 1. Аутентификация на passport.moex.com (как в Python примере)
        const authString = Buffer.from(`${username}:${password}`).toString('base64');
        const authResponse = await fetch('https://passport.moex.com/authenticate', {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${authString}`
            }
        });

        if (!authResponse.ok) {
            throw new Error('MOEX authentication failed');
        }

        // Извлекаем cookie из ответа
        const setCookie = authResponse.headers.get('set-cookie');
        if (!setCookie || !setCookie.includes('MicexPassportCert')) {
            throw new Error('MicexPassportCert cookie not received');
        }

        // 2. Запрос данных по Si-3.26 с полученной cookie
        const moexUrl = `https://iss.moex.com/iss/engines/futures/markets/forts/boards/forts/securities/Si-3.26/candles.json?from=${from}&till=${till}&interval=60&iss.only=candles`;
        
        const dataResponse = await fetch(moexUrl, {
            headers: {
                'Cookie': setCookie.split(';')[0] // берём только имя=значение
            }
        });

        if (!dataResponse.ok) {
            throw new Error(`MOEX data request failed: ${dataResponse.status}`);
        }

        const data = await dataResponse.json();
        res.status(200).json(data);

    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
}
