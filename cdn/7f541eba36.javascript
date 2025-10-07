const express = require('express');
const { join } = require('path');
const { config } = require('dotenv');
const { Octokit } = require('@octokit/rest');
const fileUpload = require('express-fileupload');
const cors = require('cors');
const crypto = require('crypto');
const { Readable } = require('stream');
const mime = require('mime-types');

config();

const app = express();
const port = process.env.SERVER_PORT || 3000;

const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
});
const githubRepoOwner = process.env.GITHUB_REPO_OWNER;
const githubRepoName = process.env.GITHUB_REPO_NAME;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
app.use(express.static(join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));

app.get('/', (req, res) => {
    res.render('index', {
        GITHUB_REPO_OWNER: githubRepoOwner,
        GITHUB_REPO_NAME: githubRepoName
    });
});

app.post('/upload', async (req, res) => {
    try {
        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).json({ message: 'Tidak ada file yang diupload.' });
        }

        const uploadedFile = req.files.cdnFile;
        const randomName = crypto.randomBytes(5).toString('hex');
        const extension = uploadedFile.name.split('.').pop();
        const finalName = `${randomName}.${extension}`;

        const filePathInRepo = `cdn/${finalName}`;
        const fileContentBase64 = uploadedFile.data.toString('base64');

        let sha = null;
        try {
            const { data } = await octokit.repos.getContent({
                owner: githubRepoOwner,
                repo: githubRepoName,
                path: filePathInRepo,
            });
            sha = data.sha;
        } catch {}

        await octokit.repos.createOrUpdateFileContents({
            owner: githubRepoOwner,
            repo: githubRepoName,
            path: filePathInRepo,
            message: `feat: Add ${finalName} to CDN`,
            content: fileContentBase64,
            sha: sha,
        });

        const fileUrl = `${req.protocol}://${req.headers.host}/file/${finalName}`;
        res.status(200).json({
            message: 'File berhasil diupload!',
            url: fileUrl,
            size: uploadedFile.size,
            type: uploadedFile.mimetype,
            uploadedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error saat upload file ke GitHub:', error);
        res.status(500).json({ message: 'Gagal mengupload file.', error: error.message });
    }
});

app.get('/file/:filename', async (req, res) => {
    const filename = req.params.filename;
    const filePathInRepo = `cdn/${filename}`;

    try {
        const { data } = await octokit.repos.getContent({
            owner: githubRepoOwner,
            repo: githubRepoName,
            path: filePathInRepo,
        });

        const fileBuffer = Buffer.from(data.content, 'base64');
        const contentType = mime.lookup(filename) || 'application/octet-stream';

        res.set('Access-Control-Allow-Origin', '*');
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=31536000, immutable');

        const stream = Readable.from(fileBuffer);
        stream.pipe(res);

    } catch (error) {
        console.error('Error saat mengambil file dari GitHub:', error);
        if (error.status === 404) {
            return res.status(404).json({ message: 'File tidak ditemukan.' });
        }
        res.status(500).json({ message: 'Gagal mengambil file.', error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});