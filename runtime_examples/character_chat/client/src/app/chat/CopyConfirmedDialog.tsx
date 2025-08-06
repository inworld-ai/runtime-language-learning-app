import { Alert, Dialog, DialogContent } from '@mui/material';

interface CopyConfirmedDialogProps {
  copyConfirmOpen: boolean;
  copyDestination: string;
  setCopyConfirmOpen: (value: boolean) => void;
}

export const CopyConfirmedDialog = (props: CopyConfirmedDialogProps) => {
  return (
    <Dialog
      open={props.copyConfirmOpen}
      onClose={() => props.setCopyConfirmOpen(false)}
    >
      <DialogContent>
        <Alert severity="success">
          Transcript successfully copied to {props.copyDestination}
        </Alert>
      </DialogContent>
    </Dialog>
  );
};
