import { Box, TextField } from '@mui/material';
import { useCallback, useMemo } from 'react';
import { useFormContext } from 'react-hook-form';

import { save as saveConfiguration } from '../helpers/configuration';
import { ConfigurationSession } from '../types';

const FIELD_NAME = 'agent.knowledge';

export const AgentKnowledge = () => {
  const { getValues, formState, register, setValue } =
    useFormContext<ConfigurationSession>();

  const onChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setValue(FIELD_NAME, event.target.value);
      saveConfiguration(getValues());
    },
    [getValues, setValue],
  );

  const errorMessage = useMemo(
    () => formState.errors?.agent?.knowledge?.message,
    [formState],
  );

  return (
    <Box sx={{ m: 2 }}>
      <TextField
        fullWidth
        multiline
        minRows={2}
        maxRows={4}
        id="agent-knowledge"
        size="small"
        label="Agent Knowledge"
        placeholder="Enter knowledge"
        InputLabelProps={{ shrink: true }}
        {...{ error: !!errorMessage, helperText: errorMessage }}
        {...register(FIELD_NAME, { onChange })}
      />
    </Box>
  );
};
