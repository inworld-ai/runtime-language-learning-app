import 'dotenv/config';

import {
  configureMetric,
  generateExecutionId,
  initTelemetry,
  logger,
  metric,
  MetricType,
  shutdownTelemetry,
  startSpan,
  startSpanWithParent,
  TelemetryLogLevel,
} from '@inworld/runtime/telemetry';

const minimist = require('minimist');

const usage = `
Usage:
    yarn telemetry-capabilities [options]

Options:
    --mode=<demo|basic|advanced|error|metrics|logging>[optional, default=demo] \n
    --apiKey=<api-key>[optional, uses INWORLD_API_KEY env var] \n
    --appName=<app-name>[optional, default=telemetry-demo] \n
    --appVersion=<app-version>[optional, default=1.0.0] \n
    --exporterType=<LOCAL|REMOTE>[optional, default=LOCAL] \n
    --samplingRate=<0.0-1.0>[optional, default=1.0] \n
    --logLevel=<TRACE|DEBUG|INFO|WARN|ERROR>[optional, default=INFO] \n
    --endpoint=<telemetry-endpoint>[optional, uses default endpoint] \n

Examples:
    # Run all demos
    yarn telemetry-capabilities

    # Run basic span demo
    yarn telemetry-capabilities --mode=basic

    # Run advanced demo with custom configuration
    yarn telemetry-capabilities --mode=advanced --appName="my-app" --samplingRate=0.5

    # Run error handling demo
    yarn telemetry-capabilities --mode=error

    # Run metrics integration demo
    yarn telemetry-capabilities --mode=metrics

    # Run with remote exporter
    yarn telemetry-capabilities --exporterType=REMOTE --endpoint="https://your-telemetry-endpoint.com"

    # Run logging demo
    yarn telemetry-capabilities --mode=logging
    `;

run();

async function run() {
  const args = parseArgs();

  console.log('🚀 Starting Telemetry Spans Demo');
  console.log('Configuration:', {
    mode: args.mode,
    appName: args.appName,
    appVersion: args.appVersion,
    exporterType: args.exporterType,
    samplingRate: args.samplingRate,
    logLevel: args.logLevel,
  });

  try {
    initTelemetry({
      apiKey: args.apiKey || process.env.INWORLD_API_KEY,
      appName: args.appName,
      appVersion: args.appVersion,
      /*      endpoint: args.endpoint,
      exporterType: args.exporterType as any,
      logger: {
        level: args.logLevel as any,
        sinkAbslLogs: true,
      },
      tracer: {
        samplingRate: args.samplingRate,
      },*/
    });
    console.log('✅ Telemetry initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize telemetry:', error);
    process.exit(1);
  }

  try {
    switch (args.mode) {
      case 'basic':
        await runBasicDemo();
        break;
      case 'advanced':
        await runAdvancedDemo();
        break;
      case 'error':
        await runErrorDemo();
        break;
      case 'metrics':
        await runMetricsDemo();
        break;
      case 'logging':
        await runLoggingDemo();
        break;
      case 'demo':
      default:
        await runFullDemo();
        break;
    }
  } catch (error) {
    console.error('❌ execution failed:', error);
  } finally {
    shutdownTelemetry();
    console.log('✅ Telemetry shutdown completed');
  }
}

async function runBasicDemo() {
  console.log('\n📋 Running Basic Span Demo');

  const span = startSpan('basic_operation');

  try {
    console.log('  Performing basic operation...');

    await simulateWork(1000);

    span.setAttribute('operation.type', 'basic');
    span.setAttribute('user.id', '12345');
    span.setAttribute('processing.time_ms', '1000');

    console.log('  Basic operation completed successfully');
    span.setOK();
  } catch (error) {
    console.error('  Basic operation failed:', error);
    span.setError(`Basic operation failed: ${error.message}`);
  } finally {
    span.end();
  }
}

async function runAdvancedDemo() {
  console.log('\n🔧 Running Advanced Span Demo');

  const parentSpan = startSpan('advanced_workflow');
  parentSpan.setAttribute('workflow.id', generateExecutionId());
  parentSpan.setAttribute('workflow.type', 'advanced');

  try {
    console.log('  Starting advanced workflow...');

    const validationSpan = startSpanWithParent(
      'data_validation',
      { step: 'validation', 'data.type': 'user_input' },
      [],
      parentSpan,
    );

    try {
      console.log('    Validating data...');
      await simulateWork(500);

      validationSpan.setAttribute('validation.result', 'success');
      validationSpan.setAttribute('validation.rules.applied', '5');
      validationSpan.setOK();
    } catch (error) {
      validationSpan.setError(`Validation failed: ${error.message}`);
      throw error;
    } finally {
      validationSpan.end();
    }

    const dbSpan = startSpanWithParent(
      'database_operation',
      { step: 'database', operation: 'insert' },
      [],
      parentSpan,
    );

    try {
      console.log('    Performing database operation...');
      await simulateWork(800);

      dbSpan.setAttribute('db.table', 'users');
      dbSpan.setAttribute('db.rows.affected', '1');
      dbSpan.setAttribute('db.connection.pool.size', '10');
      dbSpan.setOK();
    } catch (error) {
      dbSpan.setError(`Database operation failed: ${error.message}`);
      throw error;
    } finally {
      dbSpan.end();
    }

    const apiSpan = startSpanWithParent(
      'external_api_call',
      { step: 'api', 'api.service': 'notification' },
      [],
      parentSpan,
    );

    try {
      console.log('    Calling external API...');
      await simulateWork(1200);

      apiSpan.setAttribute('api.endpoint', '/api/notifications');
      apiSpan.setAttribute('api.method', 'POST');
      apiSpan.setAttribute('api.status_code', '200');
      apiSpan.setAttribute('api.response.time_ms', '1200');
      apiSpan.setOK();
    } catch (error) {
      apiSpan.setError(`API call failed: ${error.message}`);
      throw error;
    } finally {
      apiSpan.end();
    }

    console.log('  Advanced workflow completed successfully');
    parentSpan.setOK();
  } catch (error) {
    console.error('  Advanced workflow failed:', error);
    parentSpan.setError(`Workflow failed: ${error.message}`);
  } finally {
    parentSpan.end();
  }
}

async function runErrorDemo() {
  console.log('\n⚠️  Running Error Handling Demo');

  const span = startSpan('error_demo');
  span.setAttribute('demo.type', 'error_handling');

  try {
    console.log('  Simulating various error scenarios...');

    const timeoutSpan = startSpanWithParent(
      'network_request',
      { scenario: 'timeout', 'timeout.ms': '5000' },
      [],
      span,
    );

    try {
      console.log('    Simulating network timeout...');
      await simulateWork(100);

      throw new Error('Network timeout after 5 seconds');
    } catch (error) {
      timeoutSpan.setAttribute('error.type', 'timeout');
      timeoutSpan.setAttribute('error.code', 'NETWORK_TIMEOUT');
      timeoutSpan.setError(`Network request failed: ${error.message}`);
    } finally {
      timeoutSpan.end();
    }

    const dbErrorSpan = startSpanWithParent(
      'database_connection',
      { scenario: 'connection_error', 'db.type': 'postgresql' },
      [],
      span,
    );

    try {
      console.log('    Simulating database connection error...');
      await simulateWork(200);

      throw new Error('Connection refused: database server unavailable');
    } catch (error) {
      dbErrorSpan.setAttribute('error.type', 'connection_error');
      dbErrorSpan.setAttribute('error.code', 'DB_CONNECTION_REFUSED');
      dbErrorSpan.setAttribute('db.host', 'localhost');
      dbErrorSpan.setAttribute('db.port', '5432');
      dbErrorSpan.setError(`Database connection failed: ${error.message}`);
    } finally {
      dbErrorSpan.end();
    }

    const validationErrorSpan = startSpanWithParent(
      'data_validation',
      { scenario: 'validation_error', 'data.type': 'user_profile' },
      [],
      span,
    );

    try {
      console.log('    Simulating validation error...');
      await simulateWork(150);

      throw new Error('Invalid email format: missing @ symbol');
    } catch (error) {
      validationErrorSpan.setAttribute('error.type', 'validation_error');
      validationErrorSpan.setAttribute('error.field', 'email');
      validationErrorSpan.setAttribute('error.rule', 'email_format');
      validationErrorSpan.setAttribute('error.value', 'invalid-email');
      validationErrorSpan.setError(`Validation failed: ${error.message}`);
    } finally {
      validationErrorSpan.end();
    }

    console.log('  Error scenarios completed');
    span.setOK();
  } catch (error) {
    console.error('  Error demo failed:', error);
    span.setError(`Error demo failed: ${error.message}`);
  } finally {
    span.end();
  }
}

async function runMetricsDemo() {
  console.log('\n📊 Running Metrics Integration Demo');

  const span = startSpan('metrics_integration');
  span.setAttribute('demo.type', 'metrics_integration');

  const startTime = Date.now();

  try {
    console.log('  Processing batch with metrics...');

    configureMetric({
      metricType: MetricType.COUNTER_UINT,
      name: 'batch.items_processed',
      description: 'Number of items processed in batch',
      unit: 'items',
    });

    configureMetric({
      metricType: MetricType.HISTOGRAM_UINT,
      name: 'batch.processing_time_ms',
      description: 'Time taken to process batch items',
      unit: 'milliseconds',
    });

    configureMetric({
      metricType: MetricType.GAUGE_INT,
      name: 'batch.active_workers',
      description: 'Number of active workers processing batch',
      unit: 'workers',
    });

    const batchSize = 1000;
    const workers = 5;

    span.setAttribute('batch.size', batchSize.toString());
    span.setAttribute('batch.workers', workers.toString());

    metric.recordGaugeInt('batch.active_workers', workers, {
      batch_type: 'demo',
      status: 'processing',
    });

    console.log(`    Processing ${batchSize} items with ${workers} workers...`);

    await simulateWork(2000);

    const processingTime = Date.now() - startTime;

    metric.recordCounterUInt('batch.items_processed', batchSize, {
      batch_type: 'demo',
      status: 'completed',
    });

    metric.recordHistogramUInt('batch.processing_time_ms', processingTime, {
      batch_type: 'demo',
      status: 'completed',
    });

    metric.recordGaugeInt('batch.active_workers', 0, {
      batch_type: 'demo',
      status: 'completed',
    });

    span.setAttribute('batch.processing.time_ms', processingTime.toString());
    span.setAttribute('batch.items.processed', batchSize.toString());
    span.setAttribute('batch.workers.used', workers.toString());

    span.setAttributeArray('batch.tags', ['demo', 'metrics', 'integration']);
    span.setAttributeArray('batch.steps', [
      'validation',
      'processing',
      'cleanup',
    ]);

    console.log('  Batch processing completed successfully');
    span.setOK();
  } catch (error) {
    console.error('  Metrics demo failed:', error);

    metric.recordCounterUInt('batch.errors', 1, {
      batch_type: 'demo',
      error_type: 'processing_error',
    });

    span.setError(`Metrics demo failed: ${error.message}`);
  } finally {
    span.end();
  }
}

async function runLoggingDemo() {
  console.log('\n📝 Running Logging Demo');

  const span = startSpan('logging_demo');
  span.setAttribute('demo.type', 'logging');

  try {
    console.log('  Simulating various logging scenarios...');

    // Simple logging
    logger.info('User authenticated successfully');
    logger.warn('API key is about to expire');
    logger.error('Failed to connect to database');

    // Logging with context
    logger.info('User profile updated', {
      userId: 'user-123',
      fields: 'email,address',
    });

    logger.error('Payment processing failed', {
      paymentId: 'pay-456',
      reason: 'Insufficient funds',
    });

    // Logging at different levels
    logger.log(TelemetryLogLevel.DEBUG, 'Debugging user session', {
      sessionId: 'session-789',
    });

    console.log('  Logging scenarios completed');
    span.setOK();
  } catch (error) {
    console.error('  Logging demo failed:', error);
    span.setError(`Logging demo failed: ${error.message}`);
  } finally {
    span.end();
  }
}

async function runFullDemo() {
  console.log('\n🎯 Running Full Demo (All Features)');

  console.log('\n1️⃣  Basic Span Demo');
  await runBasicDemo();

  console.log('\n2️⃣  Advanced Span Demo');
  await runAdvancedDemo();

  console.log('\n3️⃣  Error Handling Demo');
  await runErrorDemo();

  console.log('\n4️⃣  Metrics Integration Demo');
  await runMetricsDemo();

  console.log('\n5️⃣  Logging Demo');
  await runLoggingDemo();

  console.log(
    '\n🎉 Full demo completed! Check your telemetry system for all the spans and metrics.',
  );
}

function parseArgs(): {
  mode: string;
  apiKey: string;
  appName: string;
  appVersion: string;
  exporterType: string;
  samplingRate: number;
  logLevel: string;
  endpoint?: string;
} {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    console.log(usage);
    process.exit(0);
  }

  const mode = argv.mode || 'demo';
  const apiKey = argv.apiKey || process.env.INWORLD_API_KEY || '';
  const appName = argv.appName || 'telemetry-demo';
  const appVersion = argv.appVersion || '1.0.0';
  const exporterType = argv.exporterType || 'LOCAL';
  const samplingRate = parseFloat(argv.samplingRate) || 1.0;
  const logLevel = argv.logLevel || 'INFO';
  const endpoint = argv.endpoint;

  if (!apiKey) {
    throw new Error(
      `You need to provide an API key via --apiKey or INWORLD_API_KEY environment variable.\n${usage}`,
    );
  }

  if (samplingRate < 0 || samplingRate > 1) {
    throw new Error('Sampling rate must be between 0.0 and 1.0');
  }

  return {
    mode,
    apiKey,
    appName,
    appVersion,
    exporterType,
    samplingRate,
    logLevel,
    endpoint,
  };
}

async function simulateWork(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
