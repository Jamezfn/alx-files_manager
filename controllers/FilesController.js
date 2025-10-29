import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ObjectId } from 'mongodb';
import redisClient from '../utils/redis.js';
import dbClient from '../utils/db.js';

const FOLDER_PATH = process.env.FOLDER_PATH || '/tmp/files_manager';

export default class FilesController {
  static async postUpload(req, res) {
    const { name, type, parentId = 0, isPublic = false, data } = req.body;

    const token = req.headers['x-token'];
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const key = `auth_${token}`;
    const userIdStr = await redisClient.client.get(key);
    if (!userIdStr) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const userId = new ObjectId(userIdStr);

    if (!name) {
      return res.status(400).json({ error: 'Missing name' });
    }

    if (!type || !['folder', 'file', 'image'].includes(type)) {
      return res.status(400).json({ error: 'Missing type' });
    }

    if (type !== 'folder' && !data) {
      return res.status(400).json({ error: 'Missing data' });
    }

    let parentIdValue;
    if (parentId && parentId !== '0') {
      try {
        parentIdValue = new ObjectId(parentId);
        const files = dbClient.db.collection('files');
        const parentFile = await files.findOne({ _id: parentIdValue });
        if (!parentFile) {
          return res.status(400).json({ error: 'Parent not found' });
        }
        if (parentFile.type !== 'folder') {
          return res.status(400).json({ error: 'Parent is not a folder' });
        }
      } catch (err) {
        return res.status(400).json({ error: 'Parent not found' });
      }
    } else {
      parentIdValue = '0';
    }

    const filesCollection = dbClient.db.collection('files');
    const fileDoc = {
      userId,
      name,
      type,
      isPublic,
      parentId: parentIdValue,
    };

    let result;
    if (type === 'folder') {
      result = await filesCollection.insertOne(fileDoc);
    } else {
      if (!fs.existsSync(FOLDER_PATH)) {
        fs.mkdirSync(FOLDER_PATH, { recursive: true });
      }

      const filename = uuidv4();
      const localPath = path.join(FOLDER_PATH, filename);
      const absolutePath = path.resolve(localPath);

      const buffer = Buffer.from(data, 'base64');
      fs.writeFileSync(absolutePath, buffer);

      fileDoc.localPath = absolutePath;
      result = await filesCollection.insertOne(fileDoc);
    }

    const newFile = {
      id: result.insertedId.toString(),
      userId: userId.toString(),
      name,
      type,
      isPublic,
      parentId: parentId === 0 ? 0 : parentId,
    };

    return res.status(201).json(newFile);
  }
}