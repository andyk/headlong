import { registerThoughtHandler } from './headlong';

// Listen for changes to a thougth or new thoughts
// generate updated embeddings for the changed or new thought
// then store those embeddings in the thoughts.embedding (of type )
// and also update thought.metatdata["embedding"] = {"provider": "open_ai", "last_updated_at": <timestamp}
