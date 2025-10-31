import { ObjectId } from 'mongodb';
import sha1 from 'sha1';
import dbClient from '../utils/db.js';
import redisClient from '../utils/redis.js';
import Queue from 'bull';

export default class UsersController {
	static userQueue = new Queue('userQueue');

	static async postNew(req, res) {
		const { email, password } = req.body;
		if (!email) {
			return res.status(400).json({ error: 'Missing email' });
		}

		if (!password) {
			return res.status(400).json({ error: 'Missing password' });
		}

		const usersCollection = dbClient.db.collection('users');
		const existingUser = await usersCollection.findOne({ email });
		if (existingUser) {
			return res.status(400).json({ error: 'Already exist' });
		}

		const hashedPassword = sha1(password);

		const result = await usersCollection.insertOne({
			email,
			password: hashedPassword,
		});

		await UsersController.userQueue.add('sendWelcomeEmail', { userId: result.insertedId.toString() });

		const newUser = {
			id: result.insertedId.toString(),
			email,
		};
		return res.status(201).json(newUser);
	}

	static async getMe(req, res) {
		const token = req.headers['x-token'];
		if (!token) {
			return res.status(401).json({ error: 'Unauthorized' });
		}

		const redisKey = `auth_${token}`;
		const userId = await redisClient.get(redisKey);

		if (!userId) {
			return res.status(401).json({ error: 'Unauthorized' });
		}

		const usersCollection = dbClient.db.collection('users');
		const user = await usersCollection.findOne({ _id: new ObjectId(userId) });

		if (!user) {
			return res.status(401).json({ error: 'Unauthorized' });
		}

		return res.status(200).json({
			id: user._id.toString(),
			email: user.email,
		});
	}
}
