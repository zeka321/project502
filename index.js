const express = require('express');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;
const SECRET_KEY = crypto.randomBytes(32).toString('hex');
const DYNAMIC_KEY = crypto.randomBytes(16).toString('hex');

const allowedOrigin = ["https://autosharee.vercel.app", "https://lalat.vercel.app"];

app.use(cors({ origin: (origin, callback) => {
  if (!origin || allowedOrigin.includes(origin)) return callback(null, true);
  callback(new Error('Blocked by CORS'));
}}));
app.use(express.json());
app.use(bodyParser.json());
app.use((req, res, next) => {
  res.locals.hpToken = crypto.randomBytes(8).toString('hex');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  const token = jwt.sign({ ip: req.ip, ua: req.headers['user-agent'] }, SECRET_KEY, { expiresIn: '15m' });
  res.cookie('_secure', token, { httpOnly: true, sameSite: 'strict' }).sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/submit', async (req, res) => {
  try {
    const token = req.cookies._secure || req.headers['x-auth-token'];
    if (!token) return res.status(403).send('Missing security token');
    
    const decoded = jwt.verify(token, SECRET_KEY);
    if (decoded.ip !== req.ip || decoded.ua !== req.headers['user-agent']) {
      return res.status(403).send('Session hijacking detected');
    }

    if (req.body.hpField || !req.body._csrf) {
      return res.status(400).send('Bot trap triggered');
    }

    const origin = req.headers.origin;
    if (!allowedOrigin.includes(origin)) return res.status(400).send('Invalid origin');

    const { cookie, url, amount, interval, _csrf } = req.body;
    if (!cookie || !url || !amount || !interval || _csrf !== res.locals.hpToken) {
      return res.status(400).json({ error: 'Invalid request data' });
    }

    const cookies = await convertCookie(cookie);
    if (!cookies) return res.status(400).json({ error: 'Invalid cookies' });

    const id = await getPostID(url);
    const accessToken = await getAccessToken(cookies);
    if (!id || !accessToken) return res.status(400).json({ error: 'FB data error' });

    const sessionToken = crypto.randomBytes(12).toString('hex');
    startShareSession(cookies, url, parseInt(amount), parseInt(interval), sessionToken);
    res.status(200).json({ status: 200, token: sessionToken });
  } catch (err) {
    res.status(500).json({ status: 500, error: 'Server error' });
  }
});

async function startShareSession(cookies, url, amount, interval, sessionToken) {
  const headers = {
    'accept': '*/*',
    'cookie': cookies,
    'x-fb-request-token': crypto.createHmac('sha256', DYNAMIC_KEY).update(sessionToken).digest('hex'),
    'x-client-ip': crypto.randomBytes(8).toString('hex')
  };

  let sharedCount = 0;
  const timer = setInterval(async () => {
    try {
      const response = await axios.post(
        `https://graph.facebook.com/me/feed?link=https://m.facebook.com/${id}&published=0&access_token=${accessToken}`,
        {}, { headers }
      );
      if (response.status === 200) sharedCount++;
      if (sharedCount >= amount) clearInterval(timer);
    } catch (error) {
      clearInterval(timer);
    }
  }, interval * 1000);

  setTimeout(() => clearInterval(timer), amount * interval * 1000);
}

async function convertCookie(cookie) {
  try {
    const cookies = JSON.parse(cookie);
    if (!cookies.some(c => c.key === 'sb')) throw new Error();
    return cookies.map(c => `${c.key}=${c.value}`).join('; ');
  } catch {
    return null;
  }
}

async function getPostID(url) {
  try {
    const response = await axios.post('https://id.traodoisub.com/api.php', `link=${encodeURIComponent(url)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return response.data.id;
  } catch {
    return null;
  }
}

async function getAccessToken(cookie) {
  try {
    const response = await axios.get('https://business.facebook.com/content_management', {
      headers: { cookie, referer: 'https://www.facebook.com/' }
    });
    const tokenMatch = response.data.match(/"accessToken"\s*:\s*"([^"]+)"/);
    return tokenMatch ? tokenMatch[1] : null;
  } catch {
    return null;
  }
}

app.listen(PORT, () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
