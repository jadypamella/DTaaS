/**
 * The standard substrates the common core draws, by id. An extension may add
 * a substrate of its own, but never a private copy of one of these.
 */

import type { SubstrateAdapterFactory } from '@into-cps-association/dtaas-sdk';
import createAecSubstrate from 'viz/substrates/aecSubstrate';
import createEmbedSubstrate from 'viz/substrates/embedSubstrate';
import createImageSubstrate from 'viz/substrates/imageSubstrate';

const STANDARD: Readonly<Record<string, SubstrateAdapterFactory>> = {
  image: createImageSubstrate,
  embed: createEmbedSubstrate,
  aec: createAecSubstrate,
};

export default STANDARD;
