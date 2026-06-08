export type TopicRole = 'producer' | 'consumer';
export type BrokerType = 'kafka' | 'rabbitmq' | 'sqs' | 'pubsub' | 'unknown';
export interface TopicContract {
    topicName: string;
    role: TopicRole;
    broker: BrokerType;
    filePath: string;
}
export declare function extractTopicContracts(source: string, filePath: string): TopicContract[];
//# sourceMappingURL=topic-extractor.d.ts.map