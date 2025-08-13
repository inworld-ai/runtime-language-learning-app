import { Box, TextField } from '@mui/material';
import { useCallback, useMemo } from 'react';
import { useFormContext } from 'react-hook-form';

import { save as saveConfiguration } from '../helpers/configuration';
import { ConfigurationSession } from '../types';

const FIELD_NAME = 'agent.description';

export const AgentDescription = () => {
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
    () => formState.errors?.agent?.description?.message,
    [formState],
  );

  return (
    <Box sx={{ m: 2 }}>
      <TextField
        fullWidth
        id="agent-description"
        size="small"
        label="Agent Description"
        placeholder="Enter description"
        InputLabelProps={{ shrink: true }}
        {...{ error: !!errorMessage, helperText: errorMessage }}
        {...register(FIELD_NAME, {
          onChange,
          required: 'This field is required',
        })}
      />
    </Box>
  );
};
