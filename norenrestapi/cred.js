// module.exports = {
//   oauth_url: '',
//   debug: false,
// };

// module.exports = {
//   client_id: 'STFRM38_U',
//   Secret_Code:
//     'WwhCHnZMrK2XXXKy2o0xEICspB1g5Osw1KkPWqSO6odfmLvVvmd6rbNrGY6lHeJI',
//   Account_ID: 'STFRM38',
//   UID: 'userid',
//   oauth_url: 'https://online.moneysukh.com/authorize/oauth',
//   Access_token:
//     '84f7bab4ad5a06ecb262c4b1f13e35a14bd5a1ab775e362cf872b318f83f9370',
//   Refresh_token:
//     'ed160608c5885611445aa64b333cf7dc81e6445442addf324458293d6d43971f',
// };

// module.exports = {
//   client_id: 'STFSM50_U',
//   Secret_Code:
//     'WwhCHnZMrK2XXXKy2o0xEICspB1g5Osw1KkPWqSO6odfmLvVvmd6rbNrGY6lHeJI',
//   Account_ID: 'STFSM50',
//   UID: 'userid',
//   oauth_url: 'https://online.moneysukh.com/authorize/oauth',
//   Access_token:
//     '84f7bab4ad5a06ecb262c4b1f13e35a14bd5a1ab775e362cf872b318f83f9370',
//   Refresh_token:
//     'ed160608c5885611445aa64b333cf7dc81e6445442addf324458293d6d43971f',
// };

require('dotenv').config();

module.exports = {
  client_id: process.env.NOREN_CLIENT_ID,
  Secret_Code: process.env.NOREN_SECRET_KEY,
  Account_ID: process.env.NOREN_ACC_ID,
  UID: 'userid',
  oauth_url: process.env.NOREN_AUTH_URL,
  Access_token:
    '84f7bab4ad5a06ecb262c4b1f13e35a14bd5a1ab775e362cf872b318f83f9370',
  Refresh_token:
    'ed160608c5885611445aa64b333cf7dc81e6445442addf324458293d6d43971f',
  // Access_token: process.env.ACCESS_TOKEN,
  // Refresh_token: process.env.REFRESH_TOKEN,
};
console.log('from cred file CLIENT_ID:', process.env.NOREN_CLIENT_ID);
