import { v4 as uuidv4 } from 'uuid';
import sha1 from 'sha1';
import { ObjectId } from 'mongodb';
import redisClient from '../utils/redis.js';
import dbClient from '../utils/db.js';

export default class AuthController {
	static async getConnect(req, res) {
		const authHeader = req.headers.authorization;

		if (!authHeader || !authHeader.startsWith('Basic ')) {
			return res.status(401).json({ error: 'Unauthorized' });
		}

		const base64Credentials = authHeader.split(' ')[1];
		const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
		const [ email, password ] = credentials.split(':');

		if (!email || !password) {
			return res.status(401).json({ error: 'Unauthorized' });
		}

		const usersCollection = dbClient.db.collection('users');
		const user = await usersCollection.findOne({
			email,
			password: sha1(password)
		});

		if (!user) {
			return res.status(401).json({ error: 'Unauthorized' });
		}

		const token = uuidv4();

		const redisKey = `auth_${token}`;
		await redisClient.set(redisKey, user._id.toString(), 24 * 60 * 60);
		return res.status(200).json({ token });
	}

	static async getDisconnect(req, res) {
		const token = req.headers['x-token'];
		if (!token) {
			return res.status(401).json({ error: 'Unauthorized' });
		}

		const redisKey = `auth_${token}`;
		const userId = await redisClient.get(redisKey);

		if (!userId) {
			return res.status(401).json({ error: 'Unauthorized' });
		}

		await redisClient.del(redisKey);
		return res.status(204).send();
	}
}
