import { expect } from 'chai';
import redisClient from '../../utils/redis.js';

describe('Redis Client Tests', () => {
	it('should connect to Redis (isAlive)', async () => {
		const isAlive = redisClient.isAlive();
		expect(isAlive).to.be.true;
	});

	it('should set and get a value', async () => {
		const key = 'test_key';
		const value = 'test_value';
		await redisClient.set(key, value, 10);
		const retrieved = await redisClient.get(key);
		expect(retrieved).to.equal(value);
	});

	it('should handle TTL expiration', async () => {
		const key = 'ttl_key';
		await redisClient.set(key, 'ttl_value', 1);
		await new Promise(resolve => setTimeout(resolve, 1500));
		const retrieved = await redisClient.get(key);
		expect(retrieved).to.be.null;
	});
	it('should handle non-existent key', async () => {
		const retrieved = await redisClient.get('non_existent');
		expect(retrieved).to.be.null;
	});
	afterEach(async () => {
		await redisClient.del('test_key');
		await redisClient.del('ttl_key');
	});
});
