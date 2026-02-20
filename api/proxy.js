export default async function handler(req, res) {
    // 1. Настройка CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { username, password, from, till } = req.body;

    // Если нет логина/пароля, пробуем скачать публичные данные (для активных контрактов это работает)
    const isPublic = !username || !password;

    try {
        let cookies = '';

        // 2. Аутентификация (если переданы данные)
        if (!isPublic) {
            console.log("Authenticating with MOEX...");
            const authString = Buffer.from(`${username}:${password}`).toString('base64');
            
            // Важно: отключаем auto-redirect, чтобы перехватить куки Set-Cookie
            const authResponse = await fetch('https://passport.moex.com/authenticate', {
                method: 'GET',
                headers: { 'Authorization': `Basic ${authString}` },
                redirect: 'manual' 
            });

            // MOEX возвращает 302 Redirect при успехе, нам нужны куки из заголовка
            const setCookieHeader = authResponse.headers.get('set-cookie');
            
            if (setCookieHeader) {
                // Берем только значение куки, без атрибутов (Path, Domain и т.д.)
                const micexCert = setCookieHeader.split(';').find(c => c.trim().startsWith('MicexPassportCert='));
                if (micexCert) {
                    cookies = micexCert.trim();
                }
            }
            
            // Если куки не пришли, это не обязательно ошибка доступа, ноWarn
            if (!cookies) {
                console.log("Warning: MicexPassportCert cookie not received. Trying public access.");
            }
        }

        // 3. Запрос данных
        // Используем код SiH6 для Si-3.26. 
        // Если контракт не активен, API вернет пустой массив.
        const moexUrl = `https://iss.moex.com/iss/engines/futures/markets/forts/securities/SiH6/candles.json?from=${from}&till=${till}&interval=60&iss.only=candles`;
        
        const headers = {};
        if (cookies) {
            headers['Cookie'] = cookies;
        }

        const dataResponse = await fetch(moexUrl, { headers });

        if (!dataResponse.ok) {
            throw new Error(`MOEX data request failed: ${dataResponse.status}`);
        }

        const data = await dataResponse.json();
        
        // Проверка на пустые данные
        if (!data.candles || !data.candles.data || data.candles.data.length === 0) {
             return res.status(200).json({ 
                 ...data, 
                 warning: "Данные не найдены. Возможные причины: контракт Si-3.26 еще не активен (торгов нет), диапазон дат неверен или требуется авторизация." 
             });
        }

        res.status(200).json(data);

    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
}
