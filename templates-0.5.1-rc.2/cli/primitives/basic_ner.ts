import 'dotenv/config';

import { InworldError } from '@inworld/runtime/common';
import { NERFactory } from '@inworld/runtime/primitives/ner';

run();

async function run() {
  // Define some entities and rules for NER
  const entities = [
    {
      name: 'person',
      rules: [
        {
          name: 'firstName',
          displayName: 'First Name',
          synonyms: ['John', 'Jane', 'Michael', 'Sarah'],
        },
        {
          name: 'lastName',
          displayName: 'Last Name',
          synonyms: ['Smith', 'Johnson', 'Williams', 'Brown'],
        },
      ],
    },
    {
      name: 'location',
      rules: [
        {
          name: 'city',
          displayName: 'City',
          synonyms: ['New York', 'London', 'Paris', 'Tokyo'],
        },
        {
          name: 'country',
          displayName: 'Country',
          synonyms: ['USA', 'UK', 'France', 'Japan'],
        },
      ],
    },
  ];

  try {
    // Create NER instance with defined entities
    console.log('Creating NER instance...');
    const ner = await NERFactory.createNER(entities);

    // Example texts to analyze
    const texts = [
      'John Smith lives in New York, USA.',
      'Sarah Brown visited Paris, France last summer.',
      'Michael Johnson is moving to London, UK next month.',
      'Jane Williams loves living in Tokyo, Japan.',
    ];

    // Process each text and extract entities
    console.log('\nExtracting entities from texts:');
    for (const text of texts) {
      console.log(`\nAnalyzing text: "${text}"`);
      const matches = await ner.extractEntities(text);

      console.log('Found entities:');
      matches.forEach((match: any) => {
        // TODO: for some reason, text coming back is empty. Fix when there is a solution
        console.log(
          `- Entity: ${match.getEntityName()}, Rule: ${match.getRuleName()}, Text: "${match.getText()}"`,
        );
      });
    }

    // Clean up resources
    ner.destroy();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

function done() {
  process.exit(0);
}

process.on('SIGINT', done);
process.on('SIGTERM', done);
process.on('SIGUSR2', done);
process.on('unhandledRejection', (err: Error) => {
  if (err instanceof InworldError) {
    console.error('Inworld Error: ', {
      message: err.message,
      context: err.context,
    });
  } else {
    console.error(err.message);
  }
  process.exit(1);
});
