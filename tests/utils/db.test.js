// tests/utils/db.test.js
import { ObjectId } from 'mongodb';
import { expect } from 'chai';
import dbClient from '../../utils/db.js';

const waitForConnection = async (timeoutMs = 5000) => {
  const start = Date.now();
  while (!dbClient.isAlive()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('MongoDB connection timeout in tests');
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

describe('Database Client Tests', () => {
  let usersCollection;
  let filesCollection;

  before(async () => {
    // Wait for connection before accessing db
    await waitForConnection();
    usersCollection = dbClient.db.collection('users');
    filesCollection = dbClient.db.collection('files');
    // Initial cleanup
    await usersCollection.deleteMany({});
    await filesCollection.deleteMany({});
  });

  after(async () => {
    // Cleanup only if collections are available
    if (usersCollection) {
      await usersCollection.deleteMany({});
    }
    if (filesCollection) {
      await filesCollection.deleteMany({});
    }
  });

  it('should connect to MongoDB (isAlive)', async () => {
    // Wait again for safety in this test
    await waitForConnection();
    const isAlive = dbClient.isAlive();
    expect(isAlive).to.be.true;
  });

  it('should insert and find a user', async () => {
    await waitForConnection(); // Ensure ready
    const userDoc = {
      email: 'test@example.com',
      hashedPassword: 'hashedpass'
    };
    const insertResult = await usersCollection.insertOne(userDoc);
    const userId = insertResult.insertedId;

    const foundUser = await usersCollection.findOne({ _id: userId });
    expect(foundUser.email).to.equal('test@example.com');
    expect(foundUser.hashedPassword).to.equal('hashedpass');
  });

  it('should insert and find a file', async () => {
    await waitForConnection();
    const userId = new ObjectId();
    const fileDoc = {
      userId,
      name: 'testfile.txt',
      type: 'file',
      isPublic: false,
      parentId: '0'
    };
    const insertResult = await filesCollection.insertOne(fileDoc);
    const fileId = insertResult.insertedId;

    const foundFile = await filesCollection.findOne({ _id: fileId });
    expect(foundFile.name).to.equal('testfile.txt');
    expect(foundFile.userId.toString()).to.equal(userId.toString());
  });

  it('should handle non-existent document', async () => {
    await waitForConnection();
    const found = await usersCollection.findOne({ email: 'nonexistent@example.com' });
    expect(found).to.be.null;
  });

  it('should support aggregation for files index', async () => {
    await waitForConnection();
    const userId = new ObjectId();
    await filesCollection.insertMany([
      { userId, name: 'file1', type: 'file', parentId: '0' },
      { userId, name: 'file2', type: 'folder', parentId: '0' }
    ]);

    const pipeline = [
      { $match: { userId } },
      { $limit: 10 },
      { $project: { name: 1, type: 1 } }
    ];
    const results = await filesCollection.aggregate(pipeline).toArray();
    expect(results.length).to.equal(2);
    expect(results[0].name).to.equal('file1');
  });
});
