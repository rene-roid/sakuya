import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CharacterDetection, CharacterSummary } from '@sakuya/shared';
import { api } from '../../lib/api';
import { characterLabelText, customDisplayName, type NameOption } from '../../lib/characters';
import { toast, toastError } from '../Toast';
import { invalidateCharacters, keepTypedCase } from './NamePicker';

const optionName = (option: NameOption) =>
  option.kind === 'character' ? option.character.name! : option.kind === 'tag' ? option.tag.name : option.name;

function namedLabel(option: NameOption, name: string | null, displayName: string | null) {
  const typed = option.kind === 'new' && name ? customDisplayName(option.name, name) : null;
  return characterLabelText({ name, displayName: typed ?? displayName });
}

/** Name a whole character (an unnamed cluster) from a NamePicker option. */
export function useNameCharacter(onDone?: (named: CharacterSummary) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, option }: { id: number; option: NameOption }) => {
      const named = await api.nameCharacter(id, optionName(option));
      await keepTypedCase(option, named.name);
      return named;
    },
    onSuccess: (named, { option }) => {
      toast(`Named ${namedLabel(option, named.name, named.displayName)}`);
      invalidateCharacters(qc);
      onDone?.(named);
    },
    onError: toastError,
  });
}

/** Name or reassign one face, as from the viewer's box menu. */
export function useNameDetection(onDone?: (detection: CharacterDetection) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ detection, option }: { detection: CharacterDetection; option: NameOption }) => {
      const result =
        option.kind === 'character'
          ? await api.assignDetection(detection.id, option.character.id)
          : await api.nameDetection(detection.id, optionName(option));
      await keepTypedCase(option, result.characterName);
      return result;
    },
    onSuccess: (result, { option }) => {
      toast(`Marked as ${namedLabel(option, result.characterName, result.characterDisplayName)}`);
      invalidateCharacters(qc);
      onDone?.(result);
    },
    onError: toastError,
  });
}

/** "Not this character". */
export function useRejectDetection(onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (detection: CharacterDetection) => api.rejectDetection(detection.id),
    onSuccess: (_res, detection) => {
      toast(`Removed from ${characterLabelText({ name: detection.characterName, displayName: detection.characterDisplayName }, 'this character')}`);
      invalidateCharacters(qc);
      onDone?.();
    },
    onError: toastError,
  });
}
