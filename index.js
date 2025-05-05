const express = require('express');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigin = ["https://fb-sharer-by-bogart.vercel.app","https://lalat.vercel.app"];

app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/submit', async (req, res) => {
  const origin = req.headers.origin;
  if (!allowedOrigin.includes(origin)) {
    return res.status(400).send('tanga mo naman sabi ni kris');
  }

  const { cookie, url, amount, interval } = req.body;

  if (!cookie || !url || !amount || !interval) {
    return res.status(400).json({ error: 'Missing required fields: cookie, url, amount, or interval' });
  }

  try {
    const cookies = await convertCookie(cookie);
    if (!cookies) return res.status(400).json({ error: 'Invalid cookies format' });

    await startShareSession(cookies, url, parseInt(amount), parseInt(interval));
    res.status(200).json({ status: 200, message: 'Share session started successfully.' });

  } catch (err) {
    res.status(500).json({ status: 500, error: err.message || 'Server Error' });
  }
});

async function startShareSession(cookies, url, amount, interval) {
  const id = await getPostID(url);
  const accessToken = await getAccessToken(cookies);

  if (!id) throw new Error('Invalid URL: Post may be private or visible to friends only.');
  if (!accessToken) throw new Error('Failed to retrieve access token. Check cookies.');

  let sharedCount = 0;
  const headers = {
    accept: '*/*',
    'accept-encoding': 'gzip, deflate',
    connection: 'keep-alive',
    cookie: cookies,
    host: 'graph.facebook.com',
  };

  const timer = setInterval(async () => {
    try {
      const response = await axios.post(
        `https://graph.facebook.com/me/feed?link=https://m.facebook.com/${id}&published=0&access_token=${accessToken}`,
        {}, { headers }
      );

      if (response.status === 200) {
        sharedCount++;
      }

      if (sharedCount >= amount) {
        clearInterval(timer);
      }
    } catch (error) {
      clearInterval(timer);
    }
  }, interval * 1000);

  setTimeout(() => {
    clearInterval(timer);
  }, amount * interval * 1000);
}

async function convertCookie(cookie) {
  try {
    const cookies = JSON.parse(cookie);
    const sb = cookies.find(c => c.key === 'sb');
    if (!sb) throw new Error('Missing "sb" cookie in appstate.');

    return cookies.map(c => `${c.key}=${c.value}`).join('; ');
  } catch {
    throw new Error('Invalid appstate format. Make sure it\'s a valid JSON array.');
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
    const headers = {
      authority: 'business.facebook.com',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      cookie,
      referer: 'https://www.facebook.com/',
    };

    const response = await axios.get('https://business.facebook.com/content_management', { headers });
    const tokenMatch = response.data.match(/"accessToken"\s*:\s*"([^"]+)"/);
    return tokenMatch ? tokenMatch[1] : null;
  } catch {
    return null;
  }
}

app.listen(PORT, () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
