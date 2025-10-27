import redis from 'redis';

class RedisClient {
	constructor() {
		this.client = redis.createClient();

		this.client.on('error', (err) => {
			console.log(err);
		});

		this._isConnected = false;

		this._connectionPromise = this.client.connect()
			.then(() => {
				this._isConnected = true;
			})
			.catch((err) => {
				console.log(err);
			});
	}

	isAlive() {
		return this._isConnected;
	}

	async waitForConnection() {
		await this._connectionPromise;
	}

	async get(key) {
		return await this.client.get(key);
	}

	async set(key, value, duration) {
		await this.client.set(key, value, { EX: duration });
	}

	async del(key) {
		await this.client.del(key);
	}
}

const redisClient = new RedisClient();
export default redisClient;
