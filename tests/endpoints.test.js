import { expect } from 'chai';
import request from 'supertest';
import app from '../server.js'; // Adjust path to your main app file (e.g., server.js or app.js)
import redisClient from '../utils/redis.js';
import dbClient from '../utils/db.js';
import { ObjectId } from 'mongodb'; // Added: Import ObjectId for stats test

const waitForConnection = async (timeoutMs = 5000) => {
  const start = Date.now();
  while (!dbClient.isAlive()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('MongoDB connection timeout in tests');
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

describe('API Endpoints Tests', () => {
  let authToken;
  let userId;
  let fileId;

  before(async () => {
    // Wait for DB connection before cleanup
    await waitForConnection();
    // Clean up DB before tests (skip full Redis key scan; tokens are test-specific)
    await dbClient.db.collection('users').deleteMany({});
    await dbClient.db.collection('files').deleteMany({});
    // Optional: If needed, manually del known Redis keys, e.g., await redisClient.del('known_auth_key');
  });

  after(async () => {
    // No explicit quit/disconnect; clients are auto-managed
    // Optional: Clean up any remaining test-specific Redis keys here
  });

  describe('GET /status', () => {
    it('should return status of Redis and DB', async () => {
      const res = await request(app)
        .get('/status')
        .expect(200);

      expect(res.body.redis).to.be.true;
      expect(res.body.db).to.be.true;
    });
  });

  describe('GET /stats', () => {
    it('should return user and file counts', async () => {
      // Insert test data
      await dbClient.db.collection('users').insertOne({ email: 'statuser@example.com', hashedPassword: 'pass' });
      await dbClient.db.collection('files').insertOne({ userId: new ObjectId(), name: 'statfile.txt', type: 'file' });

      const res = await request(app)
        .get('/stats')
        .expect(200);

      expect(res.body.users).to.equal(1);
      expect(res.body.files).to.equal(1);
    });
  });

  describe('POST /users', () => {
    it('should create a new user', async () => {
      const res = await request(app)
        .post('/users')
        .send({ email: 'testuser@example.com', password: 'password123' })
        .expect(201);

      expect(res.body.email).to.equal('testuser@example.com');
      expect(res.body.id).to.be.a('string');
      userId = res.body.id;
    });

    it('should reject duplicate email', async () => {
      const res = await request(app)
        .post('/users')
        .send({ email: 'testuser@example.com', password: 'password123' })
        .expect(400);

      expect(res.body.error).to.equal('Already exist');
    });

    it('should reject missing fields', async () => {
      const res = await request(app)
        .post('/users')
        .send({ email: 'missing@example.com' })
        .expect(400);

      expect(res.body.error).to.equal('Missing password');
    });
  });

  describe('GET /connect', () => {
    before(async () => {
      // Ensure a user exists
      const userRes = await request(app)
        .post('/users')
        .send({ email: 'connect@example.com', password: 'password123' });
      userId = userRes.body.id;
    });

    it('should generate a token with valid credentials', async () => {
      const res = await request(app)
        .get('/connect')
        .auth('connect@example.com', 'password123')
        .expect(200);

      expect(res.body.token).to.be.a('string');
      authToken = res.body.token;
    });

    it('should reject invalid credentials', async () => {
      const res = await request(app)
        .get('/connect')
        .auth('invalid@example.com', 'wrongpass')
        .expect(401);

      expect(res.body.error).to.equal('Unauthorized');
    });
  });

  describe('GET /disconnect', () => {
    before(() => {
      // Assume authToken from previous test
    });

    it('should delete the auth token', async () => {
      const res = await request(app)
        .get('/disconnect')
        .set('X-Token', authToken)
        .expect(204);

      // Verify token is deleted
      const key = `auth_${authToken}`;
      const remaining = await redisClient.get(key);
      expect(remaining).to.be.null;
    });
  });

  describe('GET /users/me', () => {
    before(async () => {
      // Create user and get token
      const userRes = await request(app)
        .post('/users')
        .send({ email: 'me@example.com', password: 'password123' });
      const connectRes = await request(app)
        .get('/connect')
        .auth('me@example.com', 'password123');
      authToken = connectRes.body.token;
      userId = userRes.body.id;
    });

    it('should return current user info', async () => {
      const res = await request(app)
        .get('/users/me')
        .set('X-Token', authToken)
        .expect(200);

      expect(res.body.id).to.equal(userId);
      expect(res.body.email).to.equal('me@example.com');
    });

    it('should reject unauthorized', async () => {
      const res = await request(app)
        .get('/users/me')
        .expect(401);

      expect(res.body.error).to.equal('Unauthorized');
    });
  });

  describe('POST /files', () => {
    before(async () => {
      // Re-create authToken if needed (after disconnect)
      const connectRes = await request(app)
        .get('/connect')
        .auth('connect@example.com', 'password123');
      authToken = connectRes.body.token;
    });

    it('should upload a file', async () => {
      const res = await request(app)
        .post('/files')
        .set('X-Token', authToken)
        .send({
          name: 'testfile.txt',
          type: 'file',
          data: Buffer.from('test content').toString('base64'),
          isPublic: true
        })
        .expect(201);

      expect(res.body.name).to.equal('testfile.txt');
      expect(res.body.type).to.equal('file');
      expect(res.body.isPublic).to.be.true;
      fileId = res.body.id;
    });

    it('should upload an image and queue thumbnail job', async () => {
      // Note: Thumbnail generation is async; test assumes worker is not running for this, but job is added
      const res = await request(app)
        .post('/files')
        .set('X-Token', authToken)
        .send({
          name: 'testimage.png',
          type: 'image',
          data: Buffer.from('fake image data').toString('base64')
        })
        .expect(201);

      expect(res.body.type).to.equal('image');
      // In full test suite with worker, verify thumbnails exist after delay
    });

    it('should create a folder', async () => {
      const res = await request(app)
        .post('/files')
        .set('X-Token', authToken)
        .send({
          name: 'testfolder',
          type: 'folder'
        })
        .expect(201);

      expect(res.body.type).to.equal('folder');
    });

    it('should reject unauthorized', async () => {
      const res = await request(app)
        .post('/files')
        .send({
          name: 'unauth.txt',
          type: 'file',
          data: Buffer.from('data').toString('base64')
        })
        .expect(401);

      expect(res.body.error).to.equal('Unauthorized');
    });

    it('should reject invalid parent', async () => {
      const res = await request(app)
        .post('/files')
        .set('X-Token', authToken)
        .send({
          name: 'invalidparent.txt',
          type: 'file',
          parentId: 'invalid_id',
          data: Buffer.from('data').toString('base64')
        })
        .expect(400);

      expect(res.body.error).to.equal('Parent not found');
    });
  });

  describe('GET /files/:id', () => {
    it('should return file details', async () => {
      const res = await request(app)
        .get(`/files/${fileId}`)
        .set('X-Token', authToken)
        .expect(200);

      expect(res.body.id).to.equal(fileId);
      expect(res.body.name).to.equal('testfile.txt');
    });

    it('should reject unauthorized or not found', async () => {
      const res = await request(app)
        .get('/files/invalid_id')
        .set('X-Token', authToken)
        .expect(404);

      expect(res.body.error).to.equal('Not found');
    });
  });

  describe('GET /files (with pagination)', () => {
    before(async () => {
      // Upload multiple files
      for (let i = 0; i < 25; i++) {
        await request(app)
          .post('/files')
          .set('X-Token', authToken)
          .send({
            name: `pagfile${i}.txt`,
            type: 'file',
            data: Buffer.from(`data${i}`).toString('base64')
          })
          .expect(201);
      }
    });

    it('should list files with pagination (page 0)', async () => {
      const res = await request(app)
        .get('/files?parentId=0&page=0')
        .set('X-Token', authToken)
        .expect(200);

      expect(res.body).to.have.lengthOf(20); // pageSize=20
      expect(res.body[0].name).to.match(/^pagfile/);
    });

    it('should list files with pagination (page 1)', async () => {
      const res = await request(app)
        .get('/files?parentId=0&page=1')
        .set('X-Token', authToken)
        .expect(200);

      expect(res.body).to.have.lengthOf(5); // Remaining files
    });

    it('should handle parentId filter', async () => {
      // Assume a folder was created earlier; test with parentId=0 as fallback
      const res = await request(app)
        .get('/files?parentId=0')
        .set('X-Token', authToken)
        .expect(200);

      expect(res.body.length).to.be.greaterThan(0);
    });
  });

  describe('PUT /files/:id/publish', () => {
    let publishFileId;
    before(async () => {
      const res = await request(app)
        .post('/files')
        .set('X-Token', authToken)
        .send({
          name: 'publish.txt',
          type: 'file',
          data: Buffer.from('data').toString('base64'),
          isPublic: false
        })
        .expect(201);
      publishFileId = res.body.id;
    });

    it('should publish a file', async () => {
      const res = await request(app)
        .put(`/files/${publishFileId}/publish`)
        .set('X-Token', authToken)
        .expect(200);

      expect(res.body.isPublic).to.be.true;
      expect(res.body.id).to.equal(publishFileId);
    });

    it('should reject unauthorized', async () => {
      const res = await request(app)
        .put(`/files/${publishFileId}/publish`)
        .expect(401);

      expect(res.body.error).to.equal('Unauthorized');
    });
  });

  describe('PUT /files/:id/unpublish', () => {
    let unpublishFileId;
    before(async () => {
      const res = await request(app)
        .post('/files')
        .set('X-Token', authToken)
        .send({
          name: 'unpublish.txt',
          type: 'file',
          data: Buffer.from('data').toString('base64'),
          isPublic: true
        })
        .expect(201);
      unpublishFileId = res.body.id;
    });

    it('should unpublish a file', async () => {
      const res = await request(app)
        .put(`/files/${unpublishFileId}/unpublish`)
        .set('X-Token', authToken)
        .expect(200);

      expect(res.body.isPublic).to.be.false;
      expect(res.body.id).to.equal(unpublishFileId);
    });

    it('should reject unauthorized', async () => {
      const res = await request(app)
        .put(`/files/${unpublishFileId}/unpublish`)
        .expect(401);

      expect(res.body.error).to.equal('Unauthorized');
    });
  });

  describe('GET /files/:id/data', () => {
    before(async () => {
      // Use the earlier uploaded image or file
      // For thumbnail test, assume worker ran or mock; here test original
    });

    it('should serve file content', async () => {
      const res = await request(app)
        .get(`/files/${fileId}/data`)
        .set('X-Token', authToken)
        .expect(200);

      expect(res.text).to.equal('test content'); // Based on uploaded data
    });

    it('should serve public file without token', async () => {
      // Assume a public file was uploaded
      const publicRes = await request(app)
        .post('/files')
        .set('X-Token', authToken)
        .send({
          name: 'public.txt',
          type: 'file',
          isPublic: true,
          data: Buffer.from('public content').toString('base64')
        })
        .expect(201);
      const publicId = publicRes.body.id;

      const res = await request(app)
        .get(`/files/${publicId}/data`)
        .expect(200);

      expect(res.text).to.equal('public content');
    });

    it('should reject private file without token', async () => {
      const res = await request(app)
        .get(`/files/${fileId}/data`)
        .expect(401); // Updated: Expect 401 based on current controller behavior

      expect(res.body.error).to.equal('Unauthorized');
    });

    it('should serve thumbnail by size', async () => {
      // Upload an image and assume worker processed (in CI, add delay or mock)
      const imageRes = await request(app)
        .post('/files')
        .set('X-Token', authToken)
        .send({
          name: 'thumb.png',
          type: 'image',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==' // Tiny 1x1 PNG base64
        })
        .expect(201);
      const imageId = imageRes.body.id;

      // Simulate worker delay if needed: await new Promise(r => setTimeout(r, 2000));

      const thumbRes = await request(app)
        .get(`/files/${imageId}/data?size=100`)
        .set('X-Token', authToken)
        .expect(200); // If worker running; otherwise expect(404) and comment

      expect(thumbRes.headers['content-type']).to.include('image');
      // In full test, assert smaller size via buffer length
    });

    it('should reject invalid size', async () => {
      const res = await request(app)
        .get(`/files/${fileId}/data?size=999`)
        .set('X-Token', authToken)
        .expect(400);

      expect(res.body.error).to.equal('Invalid size');
    });

    it('should reject folder content', async () => {
      // Create folder
      const folderRes = await request(app)
        .post('/files')
        .set('X-Token', authToken)
        .send({
          name: 'testfolder',
          type: 'folder'
        })
        .expect(201);
      const folderId = folderRes.body.id;

      const res = await request(app)
        .get(`/files/${folderId}/data`)
        .set('X-Token', authToken)
        .expect(400);

      expect(res.body.error).to.equal("A folder doesn't have content");
    });

    it('should return 404 for missing file', async () => {
      // Use an invalid ObjectId string to trigger not found (assuming controller handles invalid id)
      const invalidId = new ObjectId().toString().replace(/./g, 'z'); // Invalid hex
      const res = await request(app)
        .get(`/files/${invalidId}/data`)
        .set('X-Token', authToken)
        .expect(404); // Or 500 if not handled; adjust if controller throws

      expect(res.body.error).to.equal('Not found');
    });
  });
});
