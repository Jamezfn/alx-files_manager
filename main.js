import dbClient from './utils/db.js';

const waitConnection = () => {
  return new Promise((resolve, reject) => {
    let i = 0;
    const repeatFct = async () => {
      setTimeout(() => {
        i += 1;
        if (i >= 10) {
          reject(new Error('MongoDB connection timed out after 10 attempts'));
        } else if (!dbClient.isAlive()) {
          repeatFct();
        } else {
          resolve();
        }
      }, 1000);
    };
    repeatFct();
  });
};

(async () => {
  console.log(dbClient.isAlive());
  try {
    await waitConnection();
    console.log(dbClient.isAlive());
    console.log(await dbClient.nbUsers());
    console.log(await dbClient.nbFiles());
  } catch (err) {
    console.error('Error in main:', err.message);
  }
})();
