/**
 * Jest setup file
 * This file runs before all tests and sets up the testing environment
 */

import * as dotenv from 'dotenv';

// Load test environment variables from root .env.test
dotenv.config({ path: './.env.test' });
