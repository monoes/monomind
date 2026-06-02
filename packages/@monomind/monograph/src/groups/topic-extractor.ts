export type TopicRole = 'producer' | 'consumer';
export type BrokerType = 'kafka' | 'rabbitmq' | 'sqs' | 'pubsub' | 'unknown';

export interface TopicContract {
  topicName: string;
  role: TopicRole;
  broker: BrokerType;
  filePath: string;
}

// Kafka patterns
const KAFKA_PRODUCE_RE = /(?:producer\.send|sendMessage)\s*\(\s*\{[^}]*?topic\s*:\s*['"`]([^'"`]+)['"`]/g;
const KAFKA_CONSUME_RE = /consumer\.subscribe\s*\(\s*\{[^}]*?topic\s*:\s*['"`]([^'"`]+)['"`]/g;

// RabbitMQ patterns — publish/assertExchange = producer, bindQueue/consume = consumer
const RABBIT_PRODUCE_RE = /channel\.(?:assertExchange|publish)\s*\(\s*['"`]([^'"`]+)['"`]/g;
const RABBIT_CONSUME_RE = /channel\.(?:bindQueue|consume)\s*\(\s*['"`]([^'"`]+)['"`]/g;

// AWS SQS
const SQS_SEND_RE = /(?:sendMessage|SendMessage)\s*\(\s*\{[^}]*?QueueUrl\s*:\s*['"`][^'"`]*\/([^'"`/]+)['"`]/g;

// Generic topic string patterns (fallback)
const GENERIC_TOPIC_RE = /(?:topic|TOPIC|queue|QUEUE)\s*[:=]\s*['"`]([a-z][a-z0-9._-]{2,})['"`]/g;

function detectBroker(source: string): BrokerType {
  if (/kafka/i.test(source) || /kafkajs/i.test(source)) return 'kafka';
  if (/amqplib|rabbitmq|channel\./i.test(source)) return 'rabbitmq';
  if (/SQSClient|aws-sdk.*SQS/i.test(source)) return 'sqs';
  if (/@google-cloud\/pubsub/i.test(source)) return 'pubsub';
  return 'unknown';
}

export function extractTopicContracts(source: string, filePath: string): TopicContract[] {
  const results: TopicContract[] = [];
  const broker = detectBroker(source);

  if (broker === 'kafka' || broker === 'unknown') {
    KAFKA_PRODUCE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = KAFKA_PRODUCE_RE.exec(source)) !== null) {
      results.push({ topicName: m[1]!, role: 'producer', broker: 'kafka', filePath });
    }
    KAFKA_CONSUME_RE.lastIndex = 0;
    while ((m = KAFKA_CONSUME_RE.exec(source)) !== null) {
      results.push({ topicName: m[1]!, role: 'consumer', broker: 'kafka', filePath });
    }
  }

  if (broker === 'rabbitmq' || broker === 'unknown') {
    RABBIT_PRODUCE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RABBIT_PRODUCE_RE.exec(source)) !== null) {
      results.push({ topicName: m[1]!, role: 'producer', broker: 'rabbitmq', filePath });
    }
    RABBIT_CONSUME_RE.lastIndex = 0;
    while ((m = RABBIT_CONSUME_RE.exec(source)) !== null) {
      results.push({ topicName: m[1]!, role: 'consumer', broker: 'rabbitmq', filePath });
    }
  }

  if (broker === 'sqs') {
    SQS_SEND_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SQS_SEND_RE.exec(source)) !== null) {
      results.push({ topicName: m[1]!, role: 'producer', broker: 'sqs', filePath });
    }
    // SQS receive — ReceiveMessage with QueueUrl
    const SQS_RECV_RE = /(?:receiveMessage|ReceiveMessage)\s*\(\s*\{[^}]*?QueueUrl\s*:\s*['"`][^'"`]*\/([^'"`/]+)['"`]/g;
    while ((m = SQS_RECV_RE.exec(source)) !== null) {
      results.push({ topicName: m[1]!, role: 'consumer', broker: 'sqs', filePath });
    }
  }

  if (results.length === 0 && broker === 'unknown') {
    GENERIC_TOPIC_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = GENERIC_TOPIC_RE.exec(source)) !== null) {
      results.push({ topicName: m[1]!, role: 'producer', broker: 'unknown', filePath });
    }
  }

  // Deduplicate by topicName+role
  const seen = new Set<string>();
  return results.filter(r => {
    const key = `${r.role}:${r.topicName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
