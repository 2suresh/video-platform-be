const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fsExtra = require('fs-extra'); // For ensuring directory exists
const rangeParser = require('range-parser');
require('dotenv').config();

require('dotenv').config();
const OWNCAST_URL = process.env.OWNCAST_URL;
const OWNCAST_ADMIN_TOKEN = process.env.OWNCAST_ADMIN_TOKEN;


const app = express();
const PORT = process.env.PORT || 5001; // Backend port
const VOD_DIR = path.join(__dirname, 'videos'); // Path to your VODs

// Ensure VOD directory exists
fsExtra.ensureDirSync(VOD_DIR);

// Middleware
app.use(cors()); // Allow requests from frontend (running on different port)
app.use(express.json()); // Parse JSON bodies

// --- API Routes ---

// 1. Get List of VODs
app.get('/api/vods', async (req, res) => {
    try {
        const files = await fs.promises.readdir(VOD_DIR);
        // Filter for common video types (extend as needed)
        const videos = files
            .filter(file => /\.(mp4|mkv|avi|mov)$/i.test(file))
            .map(file => ({
                id: file, // Use filename as ID for simplicity
                title: path.parse(file).name, // Get filename without extension
                url: `/api/vods/stream/${encodeURIComponent(file)}` // URL to stream the video
            }));
        res.json(videos);
    } catch (err) {
        console.error("Error reading VOD directory:", err);
        res.status(500).json({ error: 'Failed to retrieve video list.' });
    }
});

// 2. Stream a specific VOD file
app.get('/api/vods/stream/:filename', async (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    const filePath = path.join(VOD_DIR, filename);

    try {
        const stats = await fs.promises.stat(filePath);
        const fileSize = stats.size;
        const range = req.headers.range;

        // Check if file exists
         if (!stats.isFile()) {
             return res.status(404).send('File not found');
         }

        if (range) {
            // Handle range requests (for seeking)
            const parts = rangeParser(fileSize, range, { combine: true });

            if (parts === -1 || parts === -2 || parts.length > 1) {
                // Malformed range, invalid range, or multiple ranges (unsupported)
                 console.log("Range Error:", parts);
                 res.status(416).send('Requested Range Not Satisfiable');
                 return;
            }

            const { start, end } = parts[0];
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(filePath, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'video/mp4', // Adjust based on actual file type if needed
            };

            res.writeHead(206, head); // 206 Partial Content
            file.pipe(res);

        } else {
            // No range requested, stream the whole file
            const head = {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4', // Adjust based on actual file type
                 'Accept-Ranges': 'bytes', // Indicate range requests are supported
            };
            res.writeHead(200, head); // 200 OK
            fs.createReadStream(filePath).pipe(res);
        }

    } catch (err) {
         // Handle file not found or other errors
        if (err.code === 'ENOENT') {
            return res.status(404).send('File not found');
        }
        console.error(`Error streaming file ${filename}:`, err);
        res.status(500).send('Error streaming video');
    }
});

 // 3. (Optional) Endpoint to provide Owncast info
 app.get('/api/live/info', (req, res) => {
     // In a real app, you might fetch status from Owncast API if needed
     // For now, just provide the HLS URL (replace with your actual Owncast URL)
     res.json({
         hlsUrl: 'http://localhost:8080/hls/stream.m3u8', // Replace with your Owncast HLS URL
         // You could add more info like online status later by querying Owncast API
         isLive: true // Assume live for now, or implement logic to check
     });
 });


// Serve React App (Production Build) - Add this later after building the frontend
// app.use(express.static(path.join(__dirname, '..', 'frontend', 'build')));
// app.get('*', (req, res) => {
//   res.sendFile(path.resolve(__dirname, '..', 'frontend', 'build', 'index.html'));
// });

app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
    console.log(`Serving VODs from: ${VOD_DIR}`);
});


// 4. Check if Owncast stream is live
app.get('/api/live/status', async (req, res) => {
    try {
        const response = await axios.get(`${OWNCAST_URL}/api/status`);
        const { online, viewerCount, lastConnectTime } = response.data;

        res.json({
            isLive: online,
            viewers: viewerCount,
            lastConnected: lastConnectTime,
        });
    } catch (error) {
        console.error("Error fetching Owncast status:", error.message);
        res.status(500).json({ error: "Failed to fetch live status from Owncast" });
    }
});

// 5. Send a chat message to Owncast
app.post('/api/live/chat', async (req, res) => {
    const { message, displayName } = req.body;

    if (!message || !displayName) {
        return res.status(400).json({ error: 'Message and displayName are required' });
    }

    try {
        const response = await axios.post(`${OWNCAST_URL}/api/chat`, {
            body: message,
            displayName: displayName
        }, {
            headers: {
                Authorization: `Bearer ${OWNCAST_ADMIN_TOKEN}`
            }
        });

        res.json({ success: true, sent: response.status === 200 });
    } catch (err) {
        console.error('Error sending chat to Owncast:', err.message);
        res.status(500).json({ error: 'Failed to send message to stream chat.' });
    }
});
