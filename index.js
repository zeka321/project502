const express = require('express');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const activeSessions = new Map();

app.get('/active-sessions', (req, res) => {
  const data = Array.from(activeSessions.values()).map((session, index) => ({
    session: index + 1,
    url: session.url,
    count: session.count,
    id: session.id,
    target: session.target,
  }));
  res.json(data);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/submit', async (req, res) => {
  const { cookie, url, amount, interval } = req.body;
  if (!cookie || !url || !amount || !interval) {
    return res.status(400).json({ error: 'Missing state, url, amount, or interval' });
  }
  try {
    const cookies = await convertCookie(cookie);
    if (!cookies) {
      return res.status(400).json({ status: 500, error: 'Invalid cookies' });
    }
    await startShareSession(cookies, url, amount, interval);
    res.status(200).json({ status: 200 });
  } catch (err) {
    res.status(500).json({ status: 500, error: err.message || err });
  }
});

async function startShareSession(cookies, url, amount, interval) {
  const id = await getPostID(url);
  const accessToken = await getAccessToken(cookies);
  if (!id) {
    throw new Error("Unable to get link id: invalid URL, it's either a private post or visible to friends only");
  }

  const sessionId = id;
  activeSessions.set(sessionId, { url, id, count: 0, target: amount });

  const headers = {
    accept: '*/*',
    'accept-encoding': 'gzip, deflate',
    connection: 'keep-alive',
    cookie: cookies,
    host: 'graph.facebook.com',
  };

  let sharedCount = 0;
  let timer;

  async function sharePost() {
    try {
      const response = await axios.post(`https://graph.facebook.com/me/feed?link=https://m.facebook.com/${id}&published=0&access_token=${accessToken}`, {}, { headers });
      if (response.status === 200) {
        const session = activeSessions.get(sessionId);
        if (session) {
          session.count++;
          activeSessions.set(sessionId, session);
        }
        sharedCount++;
      }
      if (sharedCount >= amount) {
        clearInterval(timer);
        activeSessions.delete(sessionId);
      }
    } catch (error) {
      clearInterval(timer);
      activeSessions.delete(sessionId);
    }
  }

  timer = setInterval(sharePost, interval * 1000);
  setTimeout(() => {
    clearInterval(timer);
    activeSessions.delete(sessionId);
  }, amount * interval * 1000);
}

async function getPostID(url) {
  try {
    const response = await axios.post('https://id.traodoisub.com/api.php', `link=${encodeURIComponent(url)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
      cookie: cookie,
      referer: 'https://www.facebook.com/',
    };
    const response = await axios.get('https://business.facebook.com/content_management', { headers });
    const token = response.data.match(/"accessToken"\s*:\s*"([^"]+)"/);
    return token ? token[1] : null;
  } catch {
    return null;
  }
}

async function convertCookie(cookie) {
  try {
    const cookies = JSON.parse(cookie);
    const sbCookie = cookies.find(c => c.key === "sb");
    if (!sbCookie) throw new Error("Invalid appstate. Please provide a valid appstate.");
    const sbValue = sbCookie.value;
    const formattedCookies = [`sb=${sbValue}`]
      .concat(cookies.filter(c => c.key !== "sb").map(c => `${c.key}=${c.value}`))
      .join('; ');
    return formattedCookies;
  } catch {
    throw new Error("Error processing appstate. Please provide a valid appstate.");
  }
}

app.listen(5000, () => {
  console.log('Server is running on port 5000');
});
