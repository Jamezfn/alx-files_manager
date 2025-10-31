import Queue from 'bull';
import fs from 'fs';
import path from 'path';
import { ObjectId } from 'mongodb';
import imageThumbnail from 'image-thumbnail';
import dbClient from './utils/db.js';

const fileQueue = new Queue('fileQueue');
const userQueue = new Queue('userQueue');

fileQueue.process('generateThumbnails', async (job) => {
	const { userId, fileId } = job.data;

	if (!fileId) {
		throw new Error('Missing fileId');
	}

	if (!userId) {
		throw new Error('Missing userId');
	}

	const files = dbClient.db.collection('files');
	const file = await files.findOne({
		_id: new ObjectId(fileId),
		userId: new ObjectId(userId)
	});

	if (!file) {
		throw new Error('File not found');
	}

	if (file.type !== 'image') {
		return;
	}

	const { localPath } = file;
	const dir = path.dirname(localpath);
	const base = path.basename(localPath);
	const sizes = [500, 250, 100];

	for (const width of sizes) {
		const thumbPath = path.join(dir, `${base}_${width}`);
		const thumbBuffer = await imageThumbnail(localPath, { width });
		fs.writeFileSync(thumbPath, thumbBuffer);
	}

	userQueue.process('sendWelcomeEmail', async (job) => {
		const { userId } = job.data;

		if (!userId) {
			throw new Error('Missing userId');
		}
		
		const users = dbClient.db.collection('users');
		const user = await users.findOne({ _id: new ObjectId(userId) });

		if (!user) {
			throw new Error('User not found');
		}
		
		console.log(`Sending welcome email to ${user.email}`);
		return Promise.resolve();
	});
});
