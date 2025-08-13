import {
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  Typography,
} from '@mui/material';

import { AgentDescription } from './AgentDescription';
import { AgentMotivation } from './AgentMotivation';
import { AgentName } from './AgentName';
import { UserName } from './UserName';

interface ConfigViewProps {
  canStart: boolean;
  onStart: () => Promise<void>;
  onResetForm: () => void;
}

export const ConfigView = (props: ConfigViewProps) => {
  return (
    <>
      <Box component="form">
        <Typography variant="h3" component="h1" sx={{ m: 1 }}>
          Voice Agent
        </Typography>
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Grid container spacing={2}>
              <Grid size={12}>
                <UserName />
              </Grid>
              <Grid size={12}>
                <AgentName />
              </Grid>
              <Grid size={12}>
                <AgentDescription />
              </Grid>
              <Grid size={12}>
                <AgentMotivation />
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      </Box>
      <Grid
        container
        mt={1}
        spacing={2}
        alignItems="center"
        justifyContent={'flex-end'}
      >
        <Grid>
          <Button
            sx={{ mr: 2 }}
            variant="contained"
            onClick={props.onResetForm}
          >
            Reset
          </Button>
          <Button
            variant="contained"
            disabled={!props.canStart}
            onClick={props.onStart}
          >
            Start
          </Button>
        </Grid>
      </Grid>
    </>
  );
};
