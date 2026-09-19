// Seed only generated synthetic records into the explicitly configured HAPI test server.
// Run at startup, not build time: free hosting discards its filesystem between instances.
process.env.HOST ||= '0.0.0.0';
if (process.env.EHR_MODE === 'hapi') await import('./seed-hapi.js');
const { startServer } = await import('../src/server.js');
startServer();
