export default async function handler(req, res) {
    // Настройка CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = req.body;

    // --- РЕЖИМ 1: Запрос к DEEPSEEK (если есть поле model) ---
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

    // --- РЕЖИМ 2: Запрос данных MOEX (если есть поле username/password) ---
    const { username, password, from, till } = body;
    
    try {
        let cookieHeader = '';
        
        // Если указаны логин и пароль, пытаемся авторизоваться
        if (username && password) {
            const authString = Buffer.from(`${username}:${password}`).toString('base64');
            
            // ВАЖНО: redirect: 'manual' чтобы перехватить куки Set-Cookie до редиректа
            const authResponse = await fetch('https://passport.moex.com/authenticate', {
                method: 'GET',
                headers: { 'Authorization': `Basic ${authString}` },
                redirect: 'manual' 
            });

            const setCookie = authResponse.headers.get('set-cookie');
            if (setCookie && setCookie.includes('MicexPassportCert')) {
                cookieHeader = setCookie.split(';')[0]; // Берем только имя=значение
            } else {
                console.warn('MOEX auth failed or cookie missing. Trying public access.');
            }
        }

        // Формируем URL. Используем код SiH6 (это и есть Si-3.26)
        const moexUrl = `https://iss.moex.com/iss/engines/futures/markets/forts/securities/SiH6/candles.json?from=${from}&till=${till}&interval=60&iss.only=candles`;
        
        const headers = {};
        if (cookieHeader) headers['Cookie'] = cookieHeader;

        const dataResponse = await fetch(moexUrl, { headers });

        if (!dataResponse.ok) {
            throw new Error(`MOEX request failed: ${dataResponse.status}`);
        }

        const data = await dataResponse.json();
        
        // Проверка на пустые данные
        if (!data.candles || !data.candles.data || data.candles.data.length === 0) {
             return res.status(200).json({ 
                 ...data, 
                 warning: "Данные не получены. Возможные причины: контракт Si-3.26 (SiH6) еще не активен, торги не велись в этот период, или неверный логин/пароль." 
             });
        }

        res.status(200).json(data);

    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
}
