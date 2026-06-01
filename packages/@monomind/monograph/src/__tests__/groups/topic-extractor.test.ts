import { describe, it, expect } from 'vitest';
import { extractTopicContracts } from '../../groups/topic-extractor.js';

const KAFKA_PRODUCER_TS = `
producer.send({ topic: 'order.created', messages: [{ value: JSON.stringify(order) }] });
await producer.send({ topic: 'payment.processed', messages: [{ key: id, value: body }] });
`;

const KAFKA_CONSUMER_TS = `
await consumer.subscribe({ topic: 'order.created', fromBeginning: true });
consumer.run({ eachMessage: async ({ topic, message }) => { } });
`;

const RABBITMQ_TS = `
channel.assertExchange('inventory.exchange', 'topic');
channel.publish('inventory.exchange', 'product.updated', Buffer.from(msg));
channel.bindQueue(q.queue, 'inventory.exchange', 'product.#');
`;

describe('extractTopicContracts', () => {
  it('detects Kafka producer topics', () => {
    const result = extractTopicContracts(KAFKA_PRODUCER_TS, '/producer.ts');
    const topics = result.filter(c => c.role === 'producer').map(c => c.topicName);
    expect(topics).toContain('order.created');
    expect(topics).toContain('payment.processed');
  });

  it('detects Kafka consumer topics', () => {
    const result = extractTopicContracts(KAFKA_CONSUMER_TS, '/consumer.ts');
    const topics = result.filter(c => c.role === 'consumer').map(c => c.topicName);
    expect(topics).toContain('order.created');
  });

  it('detects RabbitMQ exchange/routing key patterns', () => {
    const result = extractTopicContracts(RABBITMQ_TS, '/rabbit.ts');
    expect(result.some(c => c.topicName.includes('inventory'))).toBe(true);
  });

  it('returns empty for unrelated source', () => {
    const result = extractTopicContracts('const x = 1;', '/utils.ts');
    expect(result).toHaveLength(0);
  });
});
