import redisClient from '../utils/redis.js';
import dbClient from '../utils/db.js';

export default class AppController {
	static getStatus(_req, res) {
		const status = {
			redis: redisClient.isAlive(),
			db:    dbClient.isAlive(),
		};
		return res.status(200).json(status);
	}

	static async getStats(_req, res) {
		const users = await dbClient.nbUsers();
		const files = await dbClient.nbFiles();
		res.status(200).json({ users, files });
	}
}
