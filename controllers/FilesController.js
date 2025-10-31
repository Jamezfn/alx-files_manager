import fs from 'fs';
import path from 'path';
import os from 'os';
import mime from 'mime-types';
import { v4 as uuidv4 } from 'uuid';
import { ObjectId } from 'mongodb';
import redisClient from '../utils/redis.js';
import dbClient from '../utils/db.js';
import Queue from 'bull';

const FOLDER_PATH = process.env.FOLDER_PATH || path.join(os.tmpdir(), 'files_manager');
const fileQueue = new Queue('fileQueue');

export default class FilesController {
	static async postUpload(req, res) {
		const { name, type, parentId = 0, isPublic = false, data } = req.body;

		const token = req.headers['x-token'];
		if (!token) {
			return res.status(401).json({ error: 'Unauthorized' });
		}
		
		const key = `auth_${token}`;
		const userIdStr = await redisClient.get(key);
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
			userId: userId,
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

			if (type === 'image') {
				fileQueue.add('generateThumbnails', {
					userId: userId.toString(),
					fileId: result.insertedId.toString(),
				}
				);
			}
		}
		
		const newFile = {
			id: result.insertedId.toString(),
			userId: userId.toString(),
			name,
			type,
			isPublic,
			parentId: parentIdValue === '0' ? 0 : parentIdValue.toString(),
		};

		return res.status(201).json(newFile);
  }
	static async getShow(req, res) {
		const { id } = req.params;

		const token = req.headers['x-token'];
		if (!token) {
			return res.status(401).json({ error: 'Unauthorized' });
		}

		const key = `auth_${token}`;
		const userIdStr = await redisClient.get(key);
		if (!userIdStr) {
			return res.status(401).json({ error: 'Unauthorized' });
		}

		const userId = new ObjectId(userIdStr);

		const fileId = new ObjectId(id);
		const files = dbClient.db.collection('files');
		const file = await files.findOne({ _id: fileId, userId });

		if (!file) {
			return res.status(404).json({ error: 'Not found' });
		}

		const response = {
			id: file._id.toString(),
			userId: file.userId.toString(),
			name: file.name,
			type: file.type,
			isPublic: file.isPublic,
			parentId: file.parentId === '0' ? 0 : file.parentId.toString(),
		};

		if (file.localPath) {
			response.localPath = file.localPath;
		}

		return res.status(200).json(response);
	}

	static async getIndex(req, res) {
		const { parentId = '0', page = '0' } = req.query;

		const token = req.headers['x-token'];
		if (!token) {
                        return res.status(401).json({ error: 'Unauthorized' });
                }

		const key = `auth_${token}`;
		const userIdStr = await redisClient.get(key);
		if (!userIdStr) {
			return res.status(401).json({ error: 'Unauthorized' });
		}

		const userId = new ObjectId(userIdStr);

		const pageSize = 20;
		const skip = parseInt(page, 10) * pageSize;

		const filesCollection = dbClient.db.collection('files');

		let matchParent = { parentId: parentId === '0' ? '0' : new ObjectId(parentId) };

		const pipeline = [
			{ $match: { userId, ...matchParent } },
			{ $skip: skip },
			{ $limit: pageSize },
			{
				$project: {
					_id: 0,
					id: { $toString: '$_id' },
					userId: { $toString: '$userId' },
					name: 1,
					type: 1,
					isPublic: 1,
					parentId: {
						$cond: {
							if: { $eq: ['$parentId', '0'] },
							then: 0,
							else: { $toString: '$parentId' }
						}
					},
				},
			},
		];

		const result = await filesCollection.aggregate(pipeline).toArray();

		return res.status(200).json(result);
	}

	static async putPublish(req, res) {
		const { id } = req.params;
		const token = req.headers['x-token'];
		if (!token) return res.status(401).json({ error: 'Unauthorized' });

		const key = `auth_${token}`;
		const userIdStr = await redisClient.get(key);
		if (!userIdStr) return res.status(401).json({ error: 'Unauthorized' });

  		let userId, fileId;
  		try {
    		userId = new ObjectId(userIdStr);
    		fileId = new ObjectId(id);
  		} catch (err) {
    		return res.status(404).json({ error: 'Not found' });
  		}

  		const files = dbClient.db.collection('files');

  		const file = await files.findOne({ _id: fileId, userId });
  		if (!file) return res.status(404).json({ error: 'Not found' });

  		await files.updateOne(
    		{ _id: fileId, userId },
    		{ $set: { isPublic: true } }
  		);

  		const updatedFile = await files.findOne({ _id: fileId, userId });

  		const response = {
    		id: updatedFile._id.toString(),
    		userId: updatedFile.userId.toString(),
    		name: updatedFile.name,
    		type: updatedFile.type,
    		isPublic: updatedFile.isPublic,
    		parentId: updatedFile.parentId === '0' ? 0 : updatedFile.parentId.toString(),
  		};

  		if (updatedFile.localPath) {
    		response.localPath = updatedFile.localPath;
  		}

  		return res.status(200).json(response);
	}

	static async putUnpublish(req, res) {
		const { id } = req.params;

		const token = req.headers['x-token'];
		if (!token) {
			return res.status(401).json({ error: 'Unauthorized' });
		}
		const key = `auth_${token}`;
		const userIdStr = await redisClient.get(key);
		if (!userIdStr) {
			return res.status(401).json({ error: 'Unauthorized' });
		}

		const userId = new ObjectId(userIdStr);

		const fileId = new ObjectId(id);
		const files = dbClient.db.collection('files');

		const file = await files.findOne({ _id: fileId, userId });
		if (!file) {
			return res.status(404).json({ error: 'Not found' });
		}

		await files.updateOne(
			{ _id: fileId, userId },
			{ $set: { isPublic: false } }
		);

		const updatedFile = await files.findOne({ _id: fileId, userId });

		if (!updatedFile) {
			return res.status(404).json({ error: 'Not found' });
		}

		const response = {
			id: updatedFile._id.toString(),
			userId: updatedFile.userId.toString(),
			name: updatedFile.name,
			type: updatedFile.type,
			isPublic: updatedFile.isPublic,
			parentId: updatedFile.parentId === '0' ? 0 : updatedFile.parentId.toString(),
		};

		if (updatedFile.localPath) {
			response.localPath = updatedFile.localPath;
		}

		return res.status(200).json(response);
	}

	static async getFile(req, res) {
		const { id } = req.params;

		const token = req.headers['x-token'];
		if (!token) {
			return res.status(401).json({ error: 'Unauthorized' });
		}

		const key = `auth_${token}`;
		const userIdStr = key ? await redisClient.get(key) : null;
		const userId = userIdStr ? new ObjectId(userIdStr) : null;

		const fileId = new ObjectId(id);

		const files = dbClient.db.collection('files');
		const file = await files.findOne({ _id: fileId });
		 if (!file) {
			 return res.status(404).json({ error: 'Not found' });
		 }

		const isOwner = userId && file.userId.toString() === userId.toString();
		if (!file.isPublic && !isOwner) {
			return res.status(404).json({ error: 'Not found' });
		}

		if (file.type === 'folder') {
			return res.status(400).json({ error: "A folder doesn't have content" });
		}

		if (!file.localPath || !fs.existsSync(file.localPath)) {
			return res.status(404).json({ error: 'Not found' });
		}

		const mimeType = mime.lookup(file.name) || 'application/octet-stream';
		res.setHeader('Content-Type', mimeType);

		const stream = fs.createReadStream(file.localPath);
		stream.on('error', () => res.status(500).end());
		stream.pipe(res);
	}
}
