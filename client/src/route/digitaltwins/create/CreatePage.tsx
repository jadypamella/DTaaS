import { Dispatch, SetStateAction, useState } from 'react';
import { Box, Button, InputAdornment, TextField, Tooltip } from '@mui/material';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import { useSelector } from 'react-redux';
import Editor from 'route/digitaltwins/editor/Editor';
import CreateDialogs from 'route/digitaltwins/create/CreateDialogs';
import { RootState } from 'store/store';
import type { LogContext } from 'util/logger/logEvent';
import {
  buildAssetsLogContext,
  buildActionLogContext,
} from 'route/digitaltwins/create/createPageLogContext';

interface CreatePageProps {
  readonly newDigitalTwinName: string;
  readonly setNewDigitalTwinName: Dispatch<SetStateAction<string>>;
}

function DigitalTwinNameInput({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  // Built the way the search field on the Manage and Execute tabs is, so the
  // first control on each tab looks the same: three hundred pixels wide, the
  // small size, an icon at the start and the name as the placeholder. The icon
  // means rename and not search, because this names a twin and finds nothing.
  //
  // A placeholder disappears once a person types, so the field carries its
  // name for assistive technology as well.
  return (
    <TextField
      fullWidth
      size="small"
      variant="outlined"
      placeholder="Digital Twin Name"
      value={value}
      onChange={onChange}
      sx={{ maxWidth: 300 }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <DriveFileRenameOutlineIcon fontSize="small" />
            </InputAdornment>
          ),
        },
        htmlInput: {
          'aria-label': 'Digital Twin Name',
          'data-logger-element': 'input',
          'data-logger-label': 'Digital twin name input',
          'data-logger-capture-value': 'true',
        },
      }}
    />
  );
}

function ActionButtons({
  onCancel,
  onSave,
  isSaveDisabled,
  logContext,
}: {
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly isSaveDisabled: boolean;
  readonly logContext: LogContext;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'flex-end',
        width: '100%',
        gap: 1,
        position: 'fixed',
        bottom: 0,
        left: 0,
        backgroundColor: 'white',
        padding: 2,
        boxShadow: '0 -2px 5px rgba(0,0,0,0.1)',
        zIndex: 10,
      }}
    >
      <Button
        variant="outlined"
        onClick={onCancel}
        data-logger-element="button"
        data-logger-label="Cancel"
        data-logger-context={JSON.stringify(
          buildActionLogContext(logContext, 'cancel'),
        )}
      >
        Cancel
      </Button>

      <Tooltip
        title={
          isSaveDisabled ? 'Add the digital twin name to enable saving' : ''
        }
        arrow
      >
        <span>
          <Button
            variant="contained"
            color="primary"
            onClick={onSave}
            disabled={isSaveDisabled}
            data-logger-element="button"
            data-logger-label="Save"
            data-logger-context={JSON.stringify(
              buildActionLogContext(logContext, 'save'),
            )}
          >
            Save
          </Button>
        </span>
      </Tooltip>
    </Box>
  );
}

function CreatePage({
  newDigitalTwinName,
  setNewDigitalTwinName,
}: CreatePageProps) {
  const [fileName, setFileName] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [fileType, setFileType] = useState('');
  const [filePrivacy, setFilePrivacy] = useState('');
  const [isLibraryFile, setIsLibraryFile] = useState(false);
  const [libraryAssetPath, setLibraryAssetPath] = useState('');
  const [openChangeFileNameDialog, setOpenChangeFileNameDialog] =
    useState(false);
  const [openDeleteFileDialog, setOpenDeleteFileDialog] = useState(false);
  const [openConfirmDeleteDialog, setOpenConfirmDeleteDialog] = useState(false);
  const [openCreateDTDialog, setOpenCreateDTDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const files = useSelector((state: RootState) => state.files) ?? [];
  const logContext = buildAssetsLogContext(newDigitalTwinName, files);

  const confirmCancel = () => {
    setOpenConfirmDeleteDialog(true);
  };

  const confirmSave = () => {
    setErrorMessage('');
    setOpenCreateDTDialog(true);
  };

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-start',
          alignItems: 'center',
          width: '100%',
          marginTop: 2,
        }}
      >
        <DigitalTwinNameInput
          value={newDigitalTwinName}
          onChange={(e) => setNewDigitalTwinName(e.target.value)}
        />
      </Box>

      {/* The same gap the Manage tab leaves between its search field and the
          cards. This used to be a negative margin, which pulled the editor up
          when the name field sat beside the tabs. With the field on a line of
          its own it pulled the buttons into the field instead. */}
      <Box sx={{ width: '100%', marginTop: 2 }}>
        <Editor
          tab="create"
          fileName={fileName}
          setFileName={setFileName}
          fileContent={fileContent}
          setFileContent={setFileContent}
          filePrivacy={filePrivacy}
          setFilePrivacy={setFilePrivacy}
          fileType={fileType}
          setFileType={setFileType}
          isLibraryFile={isLibraryFile}
          setIsLibraryFile={setIsLibraryFile}
          libraryAssetPath={libraryAssetPath}
          setLibraryAssetPath={setLibraryAssetPath}
          setOpenDeleteFileDialog={setOpenDeleteFileDialog}
          setOpenChangeFileNameDialog={setOpenChangeFileNameDialog}
        />
      </Box>

      <ActionButtons
        onCancel={confirmCancel}
        onSave={confirmSave}
        isSaveDisabled={!newDigitalTwinName}
        logContext={logContext}
      />

      <CreateDialogs
        openChangeFileNameDialog={openChangeFileNameDialog}
        setOpenChangeFileNameDialog={setOpenChangeFileNameDialog}
        fileName={fileName}
        setFileName={setFileName}
        setFileContent={setFileContent}
        setFileType={setFileType}
        openDeleteFileDialog={openDeleteFileDialog}
        setOpenDeleteFileDialog={setOpenDeleteFileDialog}
        openConfirmDeleteDialog={openConfirmDeleteDialog}
        setOpenConfirmDeleteDialog={setOpenConfirmDeleteDialog}
        openCreateDTDialog={openCreateDTDialog}
        setOpenCreateDTDialog={setOpenCreateDTDialog}
        newDigitalTwinName={newDigitalTwinName}
        setNewDigitalTwinName={setNewDigitalTwinName}
        errorMessage={errorMessage}
        setErrorMessage={setErrorMessage}
      />
    </>
  );
}

export default CreatePage;
