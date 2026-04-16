// CREATE NEW FILE at backend/config/validateEnv.js
// Add lines 1-24:

const validateEnv = () => {  // LINE 1
  const required = ['MONGODB_URI', 'JWT_SECRET'];  // LINE 2
  const missing = [];  // LINE 3
  
  for (const key of required) {  // LINE 5
    if (!process.env[key]) {  // LINE 6
      missing.push(key);  // LINE 7
    }  // LINE 8
  }  // LINE 9
  
  if (missing.length > 0) {  // LINE 11
    console.error('❌ Missing required environment variables:', missing.join(', '));  // LINE 12
    console.error('Please check your .env file');  // LINE 13
    process.exit(1);  // LINE 14
  }  // LINE 15
  
  if (process.env.JWT_SECRET === 'your_super_secret_jwt_key_change_this') {  // LINE 17
    console.warn('⚠️  Warning: Using default JWT_SECRET. Change this in production!');  // LINE 18
  }  // LINE 19
  
  console.log('✅ Environment validation passed');  // LINE 21
};  // LINE 22

module.exports = validateEnv;  // LINE 24